import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { projectCreate, projectPatch, projectQuery, project } from '../contracts/projects';
import { taskCreate, taskPatch, completeInput, reopenInput, commentInput, taskQuery, taskDetailQueryV1, boardQuery, task } from '../contracts/tasks';
import { settingsPatch } from '../contracts/settings';
import { canonicalDigest } from '../domain/request-digest';
import { localDate, localDayInterval } from '../domain/local-day';
import { Conflict, decideTask, type TaskCommand, type TaskFacts } from '../domain/tasks';
export type ApplicationCommand =
 |{kind:'project.create';input:z.infer<typeof projectCreate>}
 |{kind:'project.patch';id:string;input:z.infer<typeof projectPatch>}
 |{kind:'task.create';input:z.infer<typeof taskCreate>}
 |{kind:'task.patch';id:string;input:z.infer<typeof taskPatch>}
 |{kind:'task.complete';id:string;input:z.infer<typeof completeInput>}
 |{kind:'task.reopen';id:string;input:z.infer<typeof reopenInput>}
 |{kind:'comment.create';id:string;input:z.infer<typeof commentInput>}
 |{kind:'settings.patch';input:z.infer<typeof settingsPatch>};
export type ApplicationQuery =
 |{kind:'projects';input:z.infer<typeof projectQuery>}
 |{kind:'project';id:string}
 |{kind:'tasks';input:z.infer<typeof taskQuery>}
 |{kind:'task';id:string;input:z.infer<typeof taskDetailQueryV1>}
 |{kind:'comments';id:string;input:{limit:number;cursor?:string}}
 |{kind:'board';id:string;input:z.infer<typeof boardQuery>}
 |{kind:'settings'}
 |{kind:'overview';input:{timezone?:string;limit:number;cursor?:string}};
export type CommandContext={principal:'operator'|'reporter';method:string;path:string;key:string;digest:string;now:number};
export type SnapshotBody={data:unknown;snapshotCursor:string;generation:string};
export type CommittedReply={status:number;body:SnapshotBody};
type Row=Record<string,unknown>;
const camel=(key:string)=>key.replace(/_([a-z])/g,(_,letter:string)=>letter.toUpperCase());
const snake=(key:string)=>key.replace(/[A-Z]/g,letter=>'_'+letter.toLowerCase());
function serialize(row:Row):Row {
 return Object.fromEntries(Object.entries(row).map(([key,value])=>[camel(key),key==='tags'?JSON.parse(value as string):key.endsWith('_at')&&value!==null?new Date(value as number).toISOString():value]));
}
function persisted(record:Row):Row {
 return Object.fromEntries(Object.entries(record).map(([key,value])=>[snake(key),key==='tags'?JSON.stringify(value):key.endsWith('At')&&value!==null?Date.parse(value as string):value]));
}
export class ApplicationData {
 constructor(private readonly db:Database.Database,private readonly dataDir:string){}
 private one(table:string,id:string) {
 const row=this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as Row|undefined;
 if(!row) throw new Conflict('resource_not_found');
 return serialize(row);
 }
 private insert(table:string,row:Row){
 const values=persisted(row); const keys=Object.keys(values);
 this.db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(values));
 }
 private update(table:string,row:Row){
 const values=persisted(row);delete values.id;
 this.db.prepare(`UPDATE ${table} SET ${Object.keys(values).map(key=>`${key}=?`).join(',')} WHERE id=?`).run(...Object.values(values),row.id);
 }
 private change(entityType:string,entityId:string,projectId:string|null,kind:string,now:number){
 this.db.prepare('INSERT INTO changes(entity_type,entity_id,project_id,kind,received_at) VALUES(?,?,?,?,?)').run(entityType,entityId,projectId,kind,now);
 }
 private body(data:unknown):SnapshotBody {
 const {generation}=this.db.prepare('SELECT generation FROM instance_metadata WHERE singleton=1').get() as {generation:string};
 const {cursor}=this.db.prepare('SELECT CAST(coalesce(max(cursor),0) AS TEXT) AS cursor FROM changes').get() as {cursor:string};
 return {data,snapshotCursor:cursor,generation};
 }
 private activeProject(projectId:string){
 const value=project.parse(this.one('projects',projectId));
 if(value.archivedAt) throw new Conflict('project_archived');
 return value;
 }
 private references(projectId:string,parentId:string|null|undefined,agentId:string|null|undefined):string[]{
 if(agentId) this.one('agents',agentId);
 const ancestors:string[]=[];
 let current=parentId;
 while(current){
 const parent=task.parse(this.one('tasks',current));
 if(parent.projectId!==projectId) throw new Conflict('parent_project_mismatch');
 if(ancestors.includes(parent.id)) throw new Conflict('parent_cycle');
 ancestors.push(parent.id);current=parent.parentTaskId;
 }
 return ancestors;
 }
 private facts(value:z.infer<typeof task>,ancestors:string[]):TaskFacts {
 const latest=this.db.prepare("SELECT id,state,work_revision AS workRevision FROM runs WHERE task_id=? AND purpose='implementation' ORDER BY created_at DESC,id DESC LIMIT 1").get(value.id) as TaskFacts['latestImplementation']|undefined;
 return {projectArchived:!!this.one('projects',value.projectId).archivedAt,activeRun:!!this.db.prepare("SELECT 1 FROM runs WHERE task_id=? AND state IN ('queued','running') LIMIT 1").get(value.id),latestImplementation:latest??null,hasImplementationHistory:!!latest,ancestorIds:ancestors};
 }
 command(command:ApplicationCommand,context:CommandContext):CommittedReply {
 return this.db.transaction(()=>{
 const {principal,method,path,key,digest,now}=context;
 if(['task.complete','task.reopen','settings.patch'].includes(command.kind)&&principal!=='operator') throw new Conflict('human_required');
 const receipt=this.db.prepare('SELECT digest,status,body FROM receipts WHERE principal=? AND method=? AND path=? AND key=?').get(principal,method,path,key) as {digest:string;status:number;body:string}|undefined;
 if(receipt){if(receipt.digest!==digest) throw new Conflict('idempotency_conflict');return {status:receipt.status,body:JSON.parse(receipt.body) as SnapshotBody};}
 const time=new Date(now).toISOString();let data:unknown;let status=200;
 if(command.kind==='project.create'){
 data={id:randomUUID(),name:command.input.name,repositoryPath:command.input.repositoryPath??null,archivedAt:null,version:1,createdAt:time,updatedAt:time};
 this.insert('projects',data as Row);this.change('project',(data as Row).id as string,null,'created',now);status=201;
 }else if(command.kind==='project.patch'){
 const value=project.parse(this.one('projects',command.id));
 if(value.version!==command.input.expectedVersion) throw new Conflict('version_conflict',value.version);
 if(command.input.archived&&this.db.prepare("SELECT 1 FROM runs WHERE project_id=? AND state IN ('queued','running') LIMIT 1").get(value.id)) throw new Conflict('active_run');
 data={...value,name:command.input.name??value.name,repositoryPath:command.input.repositoryPath===undefined?value.repositoryPath:command.input.repositoryPath,archivedAt:command.input.archived===undefined?value.archivedAt:command.input.archived?value.archivedAt??time:null,version:value.version+1,updatedAt:time};
 this.update('projects',data as Row);this.change('project',value.id,value.id,'updated',now);
 }else if(command.kind==='task.create'){
 this.activeProject(command.input.projectId);this.references(command.input.projectId,command.input.parentTaskId,command.input.assignedAgentId);
 data={description:'',acceptanceCriteria:'',priority:'normal',tags:[],assignedAgentId:null,targetRole:null,parentTaskId:null,branch:null,pullRequestUrl:null,blockedReason:null,...command.input,id:randomUUID(),status:'backlog',version:1,workRevision:1,createdAt:time,updatedAt:time,completedAt:null};
 this.insert('tasks',data as Row);this.change('task',(data as Row).id as string,command.input.projectId,'created',now);status=201;
 }else if(command.kind==='settings.patch'){
 const value=this.db.prepare('SELECT timezone,version FROM settings WHERE singleton=1').get() as {timezone:string;version:number};
 if(value.version!==command.input.expectedVersion) throw new Conflict('version_conflict',value.version);
 this.db.prepare('UPDATE settings SET timezone=?,version=version+1 WHERE singleton=1').run(command.input.timezone);
 this.change('settings','settings',null,'updated',now);data=this.settings();
 }else{
 const value=task.parse(this.one('tasks',command.id));
 let input:TaskCommand;
 if(command.kind==='task.patch') {const {expectedVersion,...changes}=command.input;input={kind:'patch',expectedVersion,changes};}
 else if(command.kind==='task.complete') input={kind:'complete',...command.input};
 else if(command.kind==='task.reopen') input={kind:'reopen',...command.input};
 else input={kind:'comment',...command.input};
 const ancestors=input.kind==='patch'?this.references(value.projectId,input.changes.parentTaskId,input.changes.assignedAgentId):[];
 const decision=decideTask(value,input,this.facts(value,ancestors),principal,now);
 if(input.kind!=='comment') this.update('tasks',decision.task);
 if(input.kind==='complete'){
 data={id:randomUUID(),taskId:value.id,workRevision:value.workRevision,implementationRunId:decision.implementationRunId??null,actor:'operator',evidenceNote:input.evidenceNote,evidenceUrl:input.evidenceUrl??null,acceptedAt:time};this.insert('completions',data as Row);this.change('completion',(data as Row).id as string,value.projectId,'created',now);status=201;
 }else if(input.kind==='comment'){
 data={id:randomUUID(),taskId:value.id,text:input.text,actor:principal,createdAt:time};this.insert('comments',data as Row);this.change('comment',(data as Row).id as string,value.projectId,'created',now);status=201;
 }else if(input.kind==='reopen'){
 const fact={id:randomUUID(),taskId:value.id,workRevision:decision.task.workRevision,actor:'operator',reason:input.reason,createdAt:time};this.insert('reopens',fact);this.change('reopen',fact.id,value.projectId,'created',now);data=decision.task;
 }else data=decision.task;
 this.change('task',value.id,value.projectId,input.kind,now);
 }
 const body=this.body(data);
 this.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?,?)').run(principal,method,path,key,digest,status,JSON.stringify(body));
 return {status,body};
 }).immediate();
 }
 private settings(){
 const value=this.db.prepare('SELECT timezone,version FROM settings WHERE singleton=1').get() as {timezone:string;version:number};
 let storageBytes=0;
 for(const suffix of ['','-wal']){try{storageBytes+=statSync(join(this.dataDir,'agentflow.sqlite'+suffix)).size;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 return {...value,dataLocation:this.dataDir,storageBytes,storageMeasurement:'observational'};
 }
 private page(source:string,where:string,params:unknown[],kind:string,filters:unknown,limit:number,cursor?:string,timeColumn='created_at') {
 const generation=this.body(null).generation;
 const fingerprint=canonicalDigest({kind,filters,limit,order:timeColumn+'-id-desc'});
 let boundary='';const boundParams:unknown[]=[];
 if(cursor){
 try{
 if(!/^[A-Za-z0-9_-]+$/.test(cursor)||cursor.length>4096)throw new Error('shape');
 const parsed=z.strictObject({v:z.literal(1),generation:z.uuid(),fingerprint:z.string().length(64),time:z.number().int().safe(),id:z.string().min(1).max(100)}).parse(JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')));
 if(parsed.generation!==generation||parsed.fingerprint!==fingerprint)throw new Error('binding');
 boundary=` AND (${timeColumn}<? OR (${timeColumn}=? AND id<?))`;boundParams.push(parsed.time,parsed.time,parsed.id);
 }catch{throw new Conflict('cursor_invalid');}
 }
 const total=(this.db.prepare(`SELECT count(*) AS total FROM ${source} WHERE ${where}`).get(...params) as {total:number}).total;
 const rows=this.db.prepare(`SELECT * FROM ${source} WHERE ${where}${boundary} ORDER BY ${timeColumn} DESC,id DESC LIMIT ?`).all(...params,...boundParams,limit+1) as Row[];
 const more=rows.length>limit;const selected=rows.slice(0,limit);const last=selected.at(-1);
 const nextCursor=more&&last?Buffer.from(JSON.stringify({v:1,generation,fingerprint,time:last[timeColumn],id:last.id})).toString('base64url'):null;
 return {items:selected.map(serialize),total,nextCursor};
 }
 private taskList(input:z.infer<typeof taskQuery>){
 const {cursor,limit,...filters}=input;const clauses:string[]=[];const params:unknown[]=[];
 for(const [key,column] of [['projectId','project_id'],['status','status'],['priority','priority'],['assignedAgentId','assigned_agent_id']] as const){if(filters[key]!==undefined){clauses.push(column+'=?');params.push(filters[key]);}}
 if(filters.tag){clauses.push('EXISTS (SELECT 1 FROM json_each(tasks.tags) WHERE value=?)');params.push(filters.tag);}
 if(filters.q){clauses.push('instr(lower(title),lower(?))>0');params.push(filters.q);}
 return this.page('tasks',clauses.join(' AND ')||'1',params,'tasks',filters,limit,cursor);
 }
 private history(id:string,kind:'completion'|'reopen',limit:number,cursor?:string){
 const result=this.page(kind==='completion'?'completions':'reopens','task_id=?',[id],kind,{taskId:id},limit,cursor,kind==='completion'?'accepted_at':'created_at');
 const nextUrl=result.nextCursor?`/api/v1/tasks/${id}?history=${kind}&historyLimit=${limit}&${kind}Cursor=${result.nextCursor}`:null;
 return {items:result.items,nextCursor:result.nextCursor,nextUrl};
 }
 private overview(input:{timezone?:string;limit:number;cursor?:string},now:number){
 const settings=this.settings();const zone=input.timezone??settings.timezone as string;
 const day=localDayInterval(localDate(now,zone),zone);
 const count=(sql:string,...params:unknown[])=>(this.db.prepare(sql).get(...params) as {count:number}).count;
 const metrics={activeProjects:count('SELECT count(*) AS count FROM projects WHERE archived_at IS NULL'),reportingAgents:count("SELECT count(DISTINCT agent_id) AS count FROM runs r JOIN projects p ON p.id=r.project_id WHERE p.archived_at IS NULL AND r.state='running' AND r.last_received_at>=?",now-60000),completedToday:count("SELECT count(*) AS count FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.archived_at IS NULL AND t.status='completed' AND t.completed_at>=? AND t.completed_at<?",day.start,day.end),awaitingReview:count("SELECT count(*) AS count FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.archived_at IS NULL AND t.status='review'"),failedRunsToday:count("SELECT count(*) AS count FROM runs r JOIN projects p ON p.id=r.project_id WHERE p.archived_at IS NULL AND r.state='failed' AND r.ended_at>=? AND r.ended_at<?",day.start,day.end)};
 const source=`(SELECT t.id,t.project_id,t.id AS task_id,NULL AS run_id,t.title,t.created_at,
 (CASE WHEN trim(coalesce(t.blocked_reason,''))<>'' THEN 1 ELSE 0 END) AS blocked,
 EXISTS(SELECT 1 FROM runs r WHERE r.task_id=t.id AND r.state='failed') AS failed,
 EXISTS(SELECT 1 FROM runs r WHERE r.task_id=t.id AND r.state IN ('queued','running') AND r.last_received_at<?) AS stale
 FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.archived_at IS NULL
 UNION ALL SELECT r.id,r.project_id,NULL,r.id,coalesce(r.model,'Planning run'),r.created_at,0,r.state='failed',r.state IN ('queued','running') AND r.last_received_at<?
 FROM runs r JOIN projects p ON p.id=r.project_id WHERE r.task_id IS NULL AND p.archived_at IS NULL)`;
 const attention=this.page(source,'blocked OR failed OR stale',[now-60000,now-60000],'attention',{timezone:zone,day:localDate(now,zone)},input.limit,input.cursor);
 return {metrics,attention:{...attention,items:attention.items.map(({blocked,failed,stale,...item})=>({...item,reasons:[...(blocked?['blocked']:[]),...(failed?['failed']:[]),...(stale?['stale']:[])]}))},timezone:zone,capturedAt:new Date(now).toISOString(),day:{start:new Date(day.start).toISOString(),end:new Date(day.end).toISOString()}};
 }
 snapshot(query:ApplicationQuery,now:number):CommittedReply {
 return this.db.transaction(()=>{
 let data:unknown;
 if(query.kind==='settings') data=this.settings();
 else if(query.kind==='project') data=this.one('projects',query.id);
 else if(query.kind==='projects'){
 const {limit,cursor,...filters}=query.input;
 data=this.page('projects',filters.archived===undefined?'1':filters.archived==='true'?'archived_at IS NOT NULL':'archived_at IS NULL',[],'projects',filters,limit,cursor);
 }else if(query.kind==='tasks')data=this.taskList(query.input);
 else if(query.kind==='comments') {this.one('tasks',query.id);data=this.page('comments','task_id=?',[query.id],'comments',{taskId:query.id},query.input.limit,query.input.cursor);}
 else if(query.kind==='board'){
 this.one('projects',query.id);
 data={columns:['backlog','in_progress','review','completed'].map(status=>({status,...this.taskList({...query.input,projectId:query.id,status:status as z.infer<typeof task>['status']})}))};
 }else if(query.kind==='overview')data=this.overview(query.input,now);
 else {
 const value=task.parse(this.one('tasks',query.id));
 const accepted=this.db.prepare('SELECT * FROM completions WHERE task_id=? AND work_revision=? ORDER BY accepted_at DESC,id DESC LIMIT 1').get(value.id,value.workRevision) as Row|undefined;
 const latest=this.db.prepare('SELECT * FROM runs WHERE task_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(value.id) as Row|undefined;
 const {history,historyLimit,completionCursor,reopenCursor}=query.input;
 data={task:value,currentCompletion:value.status==='completed'&&accepted?serialize(accepted):null,latestRun:latest?serialize(latest):null,history:{commentsUrl:`/api/v1/tasks/${value.id}/comments`,completions:history==='reopen'?null:this.history(value.id,'completion',historyLimit,completionCursor),reopens:history==='completion'?null:this.history(value.id,'reopen',historyLimit,reopenCursor)}};
 }
 return {status:200,body:this.body(data)};
 })();
 }
}
