import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { projectCreate, projectPatch, projectQuery, project } from '../contracts/projects';
import { taskCreate, taskPatch, completeInput, reopenInput, commentInput, taskQuery, taskDetailQueryV1, boardQuery, task, comment, completion, reopen, run } from '../contracts/tasks';
import { settingsPatch } from '../contracts/settings';
import { canonicalDigest } from '../contracts/common';
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
 const value=this.db.prepare('SELECT timezone,version FROM settings WHERE singleton=1').get() as Row;
 let storageBytes=0;
 for(const suffix of ['','-wal']){try{storageBytes+=statSync(join(this.dataDir,'agentflow.sqlite'+suffix)).size;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 return {...value,dataLocation:this.dataDir,storageBytes,storageMeasurement:'observational'};
 }
 snapshot(query:ApplicationQuery,now:number):CommittedReply {
 return this.db.transaction(()=>{
 let data:unknown;
 if(query.kind==='settings') data=this.settings();
 else if(query.kind==='project') data=this.one('projects',query.id);
 else if(query.kind==='task'){
 const value=task.parse(this.one('tasks',query.id));
 const accepted=this.db.prepare('SELECT * FROM completions WHERE task_id=? AND work_revision=? ORDER BY accepted_at DESC,id DESC LIMIT 1').get(value.id,value.workRevision) as Row|undefined;
 data={task:value,currentCompletion:value.status==='completed'&&accepted?serialize(accepted):null,latestRun:null,history:{commentsUrl:`/api/v1/tasks/${value.id}/comments`,completions:{items:[],nextCursor:null,nextUrl:null},reopens:{items:[],nextCursor:null,nextUrl:null}}};
 }else throw new Error('QUERY_NOT_IMPLEMENTED');
 void now;return {status:200,body:this.body(data)};
 })();
 }
}
