import type Database from "better-sqlite3";
import type { CommandContext, CommittedReply, SnapshotBody } from "./application";
import { Conflict } from "../domain/tasks";
import { githubRepositoriesInput, githubRefreshInput, githubQuery, type GithubRepositoriesInput, type GithubRefreshInput, type GithubQuery, type GithubOutcome } from "../contracts/github";
export type GithubIntent = {context:CommandContext;request:GithubRefreshInput;generation:string;connectionVersion:number};
type Connection = {enabled:number;repositories:string;version:number;last_attempted_at:number|null;last_fetched_at:number|null;last_error:string|null;retry_not_before:number|null};
const iso=(value:number|null)=>value===null?null:new Date(value).toISOString();
export class GithubData {
 constructor(private db:Database.Database) {}
 private connection(){return this.db.prepare("SELECT * FROM github_connection WHERE singleton=1").get() as Connection;}
 private body(data:unknown):SnapshotBody {
  const {generation}=this.db.prepare("SELECT generation FROM instance_metadata WHERE singleton=1").get() as {generation:string};
  const {cursor}=this.db.prepare("SELECT CAST(coalesce(max(cursor),0) AS TEXT) AS cursor FROM changes").get() as {cursor:string};
  return {data,generation,snapshotCursor:cursor};
 }
 private change(now:number){this.db.prepare("INSERT INTO changes(entity_type,entity_id,project_id,kind,received_at) VALUES('github_connection','github',NULL,'updated',?)").run(now);}
 private human(context:CommandContext){if(context.principal!=="operator")throw new Conflict("human_required");}
 private replay(context:CommandContext):CommittedReply|undefined {
  this.human(context);
  const row=this.db.prepare("SELECT digest,status,body FROM receipts WHERE principal=? AND method=? AND path=? AND key=?").get(context.principal,context.method,context.path,context.key) as {digest:string;status:number;body:string}|undefined;
  if(!row)return;
  if(row.digest!==context.digest)throw new Conflict("idempotency_conflict");
  return {status:row.status,body:JSON.parse(row.body) as SnapshotBody};
 }
 private receipt(context:CommandContext,reply:CommittedReply){this.db.prepare("INSERT INTO receipts VALUES(?,?,?,?,?,?,?)").run(context.principal,context.method,context.path,context.key,context.digest,reply.status,JSON.stringify(reply.body));}
 publicConnection(credential:"configured"|"unavailable"|"repair"="unavailable",busy=false){
  const row=this.connection();return {enabled:!!row.enabled,repositories:JSON.parse(row.repositories) as string[],version:row.version,lastAttemptedAt:iso(row.last_attempted_at),lastFetchedAt:iso(row.last_fetched_at),lastError:row.last_error,retryNotBefore:iso(row.retry_not_before),credential,busy};
 }
 repositories(input:GithubRepositoriesInput,context:CommandContext){
  this.human(context);input=githubRepositoriesInput.parse(input);
  return this.db.transaction(()=>{
   const replay=this.replay(context);if(replay)return replay;
   const current=this.connection();if(current.version!==input.expectedVersion)throw new Conflict("version_conflict",current.version);
   this.db.prepare("UPDATE github_connection SET enabled=?,repositories=?,version=version+1,last_error=NULL WHERE singleton=1").run(Number(input.enabled),JSON.stringify(input.repositories));
   this.change(context.now);const reply={status:200,body:this.body(this.publicConnection())};this.receipt(context,reply);return reply;
  }).immediate();
 }
 snapshot(input:GithubQuery,now=Date.now(),credential:"configured"|"unavailable"|"repair"="unavailable",busy=false):CommittedReply {
  input=githubQuery.parse(input);
  return this.db.transaction(()=>{
   const connection=this.publicConnection(credential,busy);const generation=this.body(null).generation;
   let after:{repository:string;number:number}|undefined;
   if(input.cursor){try{const cursor=JSON.parse(Buffer.from(input.cursor,"base64url").toString("utf8")) as {generation:string;repository?:string;number?:number;after:{repository:string;number:number}};
    if(cursor.generation!==generation||cursor.repository!==input.repository||cursor.number!==input.number||typeof cursor.after.repository!=="string"||!Number.isSafeInteger(cursor.after.number))throw Error();after=cursor.after;
   }catch{throw new Conflict("cursor_invalid");}}
   const filters=["1=1"];const values:(string|number)[]=[];
   if(input.repository){filters.push("repository=?");values.push(input.repository);}
   if(input.number!==undefined){filters.push("number=?");values.push(input.number);}
   const where=filters.join(" AND ");
   const {total}=this.db.prepare(`SELECT count(*) AS total FROM github_pull_requests WHERE ${where}`).get(...values) as {total:number};
   if(after){filters.push("(repository>? OR (repository=? AND number>?))");values.push(after.repository,after.repository,after.number);}
   const rows=this.db.prepare(`SELECT * FROM github_pull_requests WHERE ${filters.join(" AND ")} ORDER BY repository,number LIMIT ?`).all(...values,input.limit+1) as {repository:string;number:number;url:string;title:string;state:"open"|"closed";draft:number;head_sha:string;base_branch:string;merged_at:string|null;previous_head_sha:string|null;fetched_at:number;last_attempted_at:number;last_error:string|null}[];
   const more=rows.length>input.limit;rows.splice(input.limit);const last=rows.at(-1);
   const items=rows.map(row=>({repository:row.repository,number:row.number,url:row.url,title:row.title,state:row.state,draft:!!row.draft,headSha:row.head_sha,baseBranch:row.base_branch,mergedAt:row.merged_at,previousHeadSha:row.previous_head_sha,fetchedAt:iso(row.fetched_at),lastAttemptedAt:iso(row.last_attempted_at),lastError:row.last_error,headChanged:row.previous_head_sha!==null,stale:!connection.enabled||!connection.repositories.includes(row.repository)||row.last_error!==null||row.previous_head_sha!==null||now-row.fetched_at>300000}));
   const lookup=input.repository&&input.number!==undefined?this.db.prepare("SELECT attempted_at,error FROM github_lookup_attempts WHERE repository=? AND number=?").get(input.repository,input.number) as {attempted_at:number;error:string|null}|undefined:undefined;
   const nextCursor=more&&last?Buffer.from(JSON.stringify({generation,repository:input.repository,number:input.number,after:{repository:last.repository,number:last.number}})).toString("base64url"):null;
   return {status:200,body:this.body({connection,items,total,nextCursor,lookupAttempt:lookup?{attemptedAt:iso(lookup.attempted_at),error:lookup.error}:null})};
  })();
 }
 admit(request:GithubRefreshInput,context:CommandContext,busy:boolean):{kind:"replay";reply:CommittedReply}|{kind:"pending";intent:GithubIntent}|{kind:"admitted";intent:GithubIntent}{
  this.human(context);request=githubRefreshInput.parse(request);
  return this.db.transaction(()=>{
   const replay=this.replay(context);if(replay)return {kind:"replay" as const,reply:replay};
   const previous=this.db.prepare("SELECT * FROM github_refresh_intents WHERE principal=? AND method=? AND path=? AND key=?").get(context.principal,context.method,context.path,context.key) as {digest:string;generation:string;connection_version:number;admitted_at:number;request:string}|undefined;
   if(previous){if(previous.digest!==context.digest)throw new Conflict("idempotency_conflict");return {kind:"pending" as const,intent:{context:{...context,now:previous.admitted_at},request:JSON.parse(previous.request) as GithubRefreshInput,generation:previous.generation,connectionVersion:previous.connection_version}};}
   const connection=this.connection();
   if(connection.version!==request.expectedVersion)throw new Conflict("version_conflict",connection.version);
   if(!connection.enabled)throw new Conflict("github_disabled");
   if(!(JSON.parse(connection.repositories) as string[]).includes(request.repository))throw new Conflict("github_repository_unselected");
   if(connection.retry_not_before!==null&&connection.retry_not_before>context.now)throw new Conflict("github_rate_limited");
   if(busy)throw new Conflict("github_busy");
   const intent={context,request,generation:this.body(null).generation,connectionVersion:connection.version};
   this.db.prepare("INSERT INTO github_refresh_intents VALUES(?,?,?,?,?,?,?,?,?,'pending',NULL,NULL)").run(context.principal,context.method,context.path,context.key,context.digest,JSON.stringify(request),intent.generation,connection.version,context.now);
   return {kind:"admitted" as const,intent};
  }).immediate();
 }
 finalize(intent:GithubIntent,outcome:GithubOutcome,now:number):CommittedReply {
  return this.db.transaction(()=>{
   const replay=this.replay(intent.context);if(replay)return replay;
   const current=this.connection();const request=intent.request;
   const superseded=this.body(null).generation!==intent.generation||current.version!==intent.connectionVersion||!current.enabled||!(JSON.parse(current.repositories) as string[]).includes(request.repository);
   if(!superseded){
    if(outcome.outcome==="fetched")for(const item of outcome.items){
     this.db.prepare(`INSERT INTO github_pull_requests VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,NULL) ON CONFLICT(repository,number) DO UPDATE SET url=excluded.url,title=excluded.title,state=excluded.state,draft=excluded.draft,previous_head_sha=CASE WHEN head_sha<>excluded.head_sha THEN head_sha ELSE previous_head_sha END,head_sha=excluded.head_sha,base_branch=excluded.base_branch,merged_at=excluded.merged_at,fetched_at=excluded.fetched_at,last_attempted_at=excluded.last_attempted_at,last_error=NULL`).run(item.repository,item.number,item.url,item.title,item.state,Number(item.draft),item.headSha,item.baseBranch,item.mergedAt,now,intent.context.now);
    }
    else this.db.prepare(`UPDATE github_pull_requests SET last_attempted_at=?,last_error=? WHERE repository=?${"number" in request?" AND number=?":""}`).run(intent.context.now,outcome.error,request.repository,...("number" in request?[request.number]:[]));
    if("number" in request)this.db.prepare("INSERT INTO github_lookup_attempts VALUES(?,?,?,?) ON CONFLICT(repository,number) DO UPDATE SET attempted_at=excluded.attempted_at,error=excluded.error").run(request.repository,request.number,intent.context.now,outcome.error);
    this.db.prepare("UPDATE github_connection SET last_attempted_at=?,last_fetched_at=CASE WHEN ? THEN ? ELSE last_fetched_at END,last_error=?,retry_not_before=? WHERE singleton=1").run(intent.context.now,Number(outcome.outcome==="fetched"),now,outcome.error,outcome.retryNotBefore);
    this.change(now);
   }
   const result={repository:request.repository,page:"page" in request?request.page:null,number:"number" in request?request.number:null,outcome:superseded?"superseded":outcome.outcome,error:superseded?null:outcome.error,attemptedAt:iso(intent.context.now),fetchedAt:!superseded&&outcome.outcome==="fetched"?iso(now):null,nextPage:!superseded?outcome.nextPage:null,count:!superseded?outcome.items.length:0};
   const reply={status:200,body:this.body(result)};
   this.db.prepare("UPDATE github_refresh_intents SET state='final',completed_at=?,result=? WHERE principal=? AND method=? AND path=? AND key=?").run(now,JSON.stringify(result),intent.context.principal,intent.context.method,intent.context.path,intent.context.key);
   this.receipt(intent.context,reply);return reply;
  }).immediate();
 }
 recover(now=Date.now()){
  const rows=this.db.prepare("SELECT * FROM github_refresh_intents WHERE state='pending'").all() as {principal:"operator";method:string;path:string;key:string;digest:string;request:string;generation:string;connection_version:number;admitted_at:number}[];
  for(const row of rows)this.finalize({context:{principal:row.principal,method:row.method,path:row.path,key:row.key,digest:row.digest,now:row.admitted_at},request:githubRefreshInput.parse(JSON.parse(row.request)),generation:row.generation,connectionVersion:row.connection_version},{outcome:"interrupted",error:"interrupted",retryNotBefore:null,items:[],nextPage:null},now);
 }
}
