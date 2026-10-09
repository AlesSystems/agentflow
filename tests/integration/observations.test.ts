import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { openOwnedStore } from '../../src/db';
import type { ApplicationCommand } from '../../src/db/application';
import { canonicalDigest } from '../../src/domain/request-digest';
it('registers stable identities and immutable attempts without adopting legacy registration identity', async () => {
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'agentflow-p04-'));
 const owned=await openOwnedStore(dir);
 const db=new Database(join(dir,'agentflow.sqlite'),{readonly:true});
 try {
 const send=(command:ApplicationCommand,key=randomUUID(),now=1000)=>owned.store.command(command,{principal:'reporter',method:'POST',path:command.kind,key,digest:canonicalDigest(command.input),now});
 const projectId=(send({kind:'project.create',input:{name:'Synthetic'}}).body.data as {id:string}).id;
 const taskId=(send({kind:'task.create',input:{projectId,title:'Synthetic'}}).body.data as {id:string}).id;
 const agentId=(send({kind:'agent.create',input:{displayName:'Synthetic',source:'fixture',defaultRole:'implementation'}}).body.data as {id:string}).id;
 const input={id:randomUUID(),projectId,taskId,agentId,purpose:'implementation' as const,expectedTaskVersion:1};
 const key=randomUUID();
 const first=send({kind:'run.register',input},key);
 expect(first.status).toBe(201);
 expect(first.body.data).toMatchObject({id:input.id,state:'queued',workRevision:2,version:1,lastSequence:0});
 expect(send({kind:'run.register',input},key)).toEqual(first);
 const retry=send({kind:'run.register',input});
 expect(retry).toEqual({...first,status:200});
 expect(()=>send({kind:'run.register',input:{...input,expectedTaskVersion:2}})).toThrow('run_conflict');
 expect(()=>send({kind:'run.register',input:{...input,id:randomUUID(),expectedTaskVersion:2}})).toThrow('active_run');
 expect(db.prepare('SELECT version,work_revision FROM tasks WHERE id=?').get(taskId)).toEqual({version:2,work_revision:2});
 expect(db.prepare('SELECT last_value FROM run_order_allocator').get()).toEqual({last_value:1});
 expect(db.prepare('SELECT count(*) AS n FROM runs').get()).toEqual({n:1});
 expect(db.prepare('SELECT count(*) AS n FROM run_registrations').get()).toEqual({n:1});
 } finally {db.close();owned.close();}
});
it('commits lifecycle facts atomically, preserves canonical duplicates and closes stale tracking without task mutation',async()=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'agentflow-p04-events-'));let owned=await openOwnedStore(dir);
 const db=new Database(join(dir,'agentflow.sqlite'));
 try {
 const send=(command:ApplicationCommand,now=1000,key=randomUUID(),principal:'reporter'|'operator'='reporter',digest=canonicalDigest(command.input))=>owned.store.command(command,{principal,method:'POST',path:command.kind==='run.event'?`/api/v1/runs/${command.id}/events`:command.kind==='run.close'?`/api/v1/runs/${command.id}/close`:command.kind,key,digest,now});
 const projectId=(send({kind:'project.create',input:{name:'Synthetic'}}).body.data as {id:string}).id;
 const taskId=(send({kind:'task.create',input:{projectId,title:'Synthetic'}}).body.data as {id:string}).id;
 const agentId=(send({kind:'agent.create',input:{displayName:'Synthetic',source:'fixture',defaultRole:'implementation'}}).body.data as {id:string}).id;
 const runId=randomUUID();send({kind:'run.register',input:{id:runId,projectId,taskId,agentId,purpose:'implementation',expectedTaskVersion:1}});
 const event=(type:'run.started'|'run.heartbeat'|'run.progress'|'run.succeeded'|'run.failed'|'run.cancelled',sequence:number,payload:unknown={})=>({kind:'run.event' as const,id:runId,input:{schemaVersion:1 as const,eventId:randomUUID(),runId,sequence,type,occurredAt:'2099-01-01T00:00:00.000Z',payload}} as ApplicationCommand & {kind:'run.event'});
 const facts=()=>({runs:db.prepare('SELECT * FROM runs').all(),tasks:db.prepare('SELECT * FROM tasks').all(),events:db.prepare('SELECT * FROM run_events').all(),changes:db.prepare('SELECT * FROM changes').all(),receipts:db.prepare('SELECT * FROM receipts').all(),closures:db.prepare('SELECT * FROM run_closures').all(),ledger:db.prepare('SELECT * FROM run_registrations').all(),allocator:db.prepare('SELECT * FROM run_order_allocator').all()});
 const reject=(command:ApplicationCommand,code:string,now=2000,principal:'reporter'|'operator'='reporter')=>{const before=facts();expect(()=>send(command,now,randomUUID(),principal)).toThrow(code);expect(facts()).toEqual(before);};
 reject(event('run.heartbeat',1),'run_transition_invalid');reject(event('run.started',2),'sequence_gap');
 const started=event('run.started',1);const start=send(started,2000);expect(start.status).toBe(201);
 expect(db.prepare('SELECT status,version,work_revision FROM tasks').get()).toEqual({status:'in_progress',version:3,work_revision:2});
 const heartbeat=event('run.heartbeat',2);const hb=send(heartbeat,3000);const beforeRetry=facts();expect(send(heartbeat,90000)).toEqual({...hb,status:200});expect(facts()).toEqual(beforeRetry);
 reject({...heartbeat,input:{...heartbeat.input,occurredAt:'2099-01-02T00:00:00.000Z'}},'idempotency_conflict');
 reject(event('run.progress',2,{message:'other ID same sequence'}),'sequence_conflict');
 const progress=event('run.progress',3,{message:'progress',percent:100});send(progress,4000);send(event('run.progress',4,{message:'rework',percent:0}),5000);
 const success=event('run.succeeded',5,{summary:'Synthetic success'});const result=send(success,6000);const terminal=facts();expect(send(success,999999)).toEqual({...result,status:200});expect(facts()).toEqual(terminal);
 reject(event('run.failed',6,{message:'late'}),'run_terminal');reject(event('run.failed',9,{message:'gap'}),'sequence_gap');
 expect(db.prepare('SELECT status,version,work_revision FROM tasks').get()).toEqual({status:'review',version:4,work_revision:2});
 expect(db.prepare('SELECT state,version,last_sequence,last_received_at,started_at,ended_at FROM runs').get()).toEqual({state:'succeeded',version:6,last_sequence:5,last_received_at:6000,started_at:2000,ended_at:6000});
 expect(db.prepare('SELECT count(*) n FROM run_events').get()).toEqual({n:5});expect(db.prepare('SELECT count(*) n FROM changes').get()).toEqual({n:17});
 const history=owned.store.snapshot({kind:'events',id:runId,input:{limit:2}},999999).body.data as {items:{type:string;sequence:number}[];nextCursor:string;total:number};expect(history.items.map(x=>x.sequence)).toEqual([1,2]);expect(history.total).toBe(5);
 const second=owned.store.snapshot({kind:'events',id:runId,input:{limit:2,cursor:history.nextCursor}},999999).body.data as {items:{sequence:number}[]};expect(second.items.map(x=>x.sequence)).toEqual([3,4]);
 const nextId=randomUUID();const registration=send({kind:'run.register',input:{id:nextId,projectId,taskId,agentId,purpose:'review',expectedTaskVersion:4}},10000);
 const close:ApplicationCommand={kind:'run.close',id:nextId,input:{expectedVersion:1,reason:'Synthetic stale record'}};const closeKey=randomUUID();
 reject(close,'human_required',70001);reject(close,'run_not_stale',70000,'operator');
 const taskBefore=db.prepare('SELECT * FROM tasks').all();const closed=send(close,70001,closeKey,'operator');expect(db.prepare('SELECT * FROM tasks').all()).toEqual(taskBefore);
 expect(db.prepare('SELECT state,version,last_sequence,last_received_at FROM runs WHERE id=?').get(nextId)).toEqual({state:'interrupted',version:2,last_sequence:0,last_received_at:10000});
 expect(db.prepare('SELECT reason,actor,created_at FROM run_closures').get()).toEqual({reason:'Synthetic stale record',actor:'operator',created_at:70001});
 expect(send(close,999999,closeKey,'operator')).toEqual(closed);reject(close,'human_required',999999);
 expect(send({kind:'run.register',input:{id:nextId,projectId,taskId,agentId,purpose:'review',expectedTaskVersion:4}},999999)).toEqual({...registration,status:200});
 const stale=owned.store.snapshot({kind:'runs',input:{limit:50,stale:'true'}},999999).body.data as {total:number};expect(stale.total).toBe(0);
 owned.close();owned=await openOwnedStore(dir);expect(send(started,999999)).toEqual({...start,status:200});
 }finally{db.close();owned.close();}
});
it('keeps legacy original registration unavailable and rejects replay without any new facts',async()=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'agentflow-p04-legacy-'));
 const {migrations}=await import('../../src/db');const old=await openOwnedStore(dir,migrations.slice(0,2));
 const projectId=randomUUID(),agentId=randomUUID(),taskId=randomUUID(),runId=randomUUID();
 const db=new Database(join(dir,'agentflow.sqlite'));db.pragma('foreign_keys=ON');
 db.prepare("INSERT INTO projects VALUES(?,'Synthetic',NULL,NULL,1,0,0)").run(projectId);
 db.prepare("INSERT INTO agents VALUES(?,'Synthetic','legacy','implementation',1,0)").run(agentId);
 db.prepare("INSERT INTO tasks(id,project_id,title,description,acceptance_criteria,status,priority,tags,version,work_revision,created_at,updated_at) VALUES(?,?,'Synthetic','','','backlog','normal','[]',1,1,0,0)").run(taskId,projectId);
 db.prepare("INSERT INTO runs(id,project_id,agent_id,task_id,purpose,work_revision,state,last_sequence,last_received_at,version,created_at) VALUES(?,?,?,?,'implementation',1,'queued',0,0,1,0)").run(runId,projectId,agentId,taskId);old.close();
 const owned=await openOwnedStore(dir);
 try {
 const facts=()=>Object.fromEntries(['runs','tasks','run_order_allocator','run_registrations','receipts','changes'].map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()]));const before=facts();
 for(const patch of [{},{model:'changed'}]){const input={id:runId,projectId,taskId,agentId,purpose:'implementation' as const,expectedTaskVersion:1,...patch};expect(()=>owned.store.command({kind:'run.register',input},{principal:'reporter',method:'POST',path:'/api/v1/runs',key:randomUUID(),digest:canonicalDigest(input),now:1000})).toThrow('run_conflict');expect(facts()).toEqual(before);}
 const read=owned.store.snapshot({kind:'run',id:runId},61000);expect(read.body.data).toMatchObject({state:'queued',freshness:{stale:true,reporting:'stale'}});
 const input={schemaVersion:1 as const,eventId:randomUUID(),runId,sequence:1,type:'run.started' as const,occurredAt:'2026-10-10T00:00:00.000Z',payload:{}};expect(owned.store.command({kind:'run.event',id:runId,input},{principal:'reporter',method:'POST',path:`/api/v1/runs/${runId}/events`,key:'',digest:canonicalDigest(input),now:1000}).status).toBe(201);
 expect(db.prepare('SELECT count(*) n FROM run_registrations').get()).toEqual({n:0});
 }finally{db.close();owned.close();}
});
it('rejects invalid references and revisions without consuming registration order or receipts',async()=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'agentflow-p04-refs-'));const owned=await openOwnedStore(dir);const db=new Database(join(dir,'agentflow.sqlite'),{readonly:true});
 try {
 const send=(command:ApplicationCommand)=>owned.store.command(command,{principal:'operator',method:'POST',path:command.kind,key:randomUUID(),digest:canonicalDigest(command.input),now:1000});
 const p=(send({kind:'project.create',input:{name:'Synthetic'}}).body.data as {id:string}).id;const p2=(send({kind:'project.create',input:{name:'Other'}}).body.data as {id:string}).id;
 const taskId=(send({kind:'task.create',input:{projectId:p,title:'Synthetic'}}).body.data as {id:string}).id;const agentId=(send({kind:'agent.create',input:{displayName:'Synthetic',source:'fixture',defaultRole:'verifier'}}).body.data as {id:string}).id;
 const input={id:randomUUID(),projectId:p,taskId,agentId,purpose:'implementation' as const,expectedTaskVersion:1};
 const facts=()=>Object.fromEntries(['tasks','runs','run_registrations','run_order_allocator','receipts','changes'].map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));
 for(const [patch,code] of [[{projectId:randomUUID()},'resource_not_found'],[{agentId:randomUUID()},'resource_not_found'],[{taskId:randomUUID()},'resource_not_found'],[{projectId:p2},'task_project_mismatch'],[{expectedTaskVersion:2},'version_conflict']] as const){const before=facts();expect(()=>send({kind:'run.register',input:{...input,...patch}})).toThrow(code);expect(facts()).toEqual(before);}
 send({kind:'task.patch',id:taskId,input:{expectedVersion:1,status:'review'}});send({kind:'task.complete',id:taskId,input:{expectedVersion:2,evidenceNote:'Synthetic fixture'}});
 const completed=facts();expect(()=>send({kind:'run.register',input:{...input,expectedTaskVersion:3}})).toThrow('task_completed');expect(facts()).toEqual(completed);
 send({kind:'project.patch',id:p,input:{expectedVersion:1,archived:true}});const archived=facts();expect(()=>send({kind:'run.register',input:{...input,expectedTaskVersion:3}})).toThrow('project_archived');expect(facts()).toEqual(archived);
 }finally{db.close();owned.close();}
});
it('serializes close against heartbeat and retains all raw heartbeat observations',async()=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'agentflow-p04-race-'));const owned=await openOwnedStore(dir);
 try{
 const send=(command:ApplicationCommand,now:number)=>owned.store.command(command,{principal:'operator',method:'POST',path:command.kind,key:randomUUID(),digest:canonicalDigest(command.input),now});
 const projectId=(send({kind:'project.create',input:{name:'Synthetic'}},1000).body.data as {id:string}).id;const agentId=(send({kind:'agent.create',input:{displayName:'Synthetic',source:'fixture',defaultRole:'verifier'}},1000).body.data as {id:string}).id;const id=randomUUID();send({kind:'run.register',input:{id,projectId,agentId,purpose:'planning'}},1000);
 const input={schemaVersion:1 as const,eventId:randomUUID(),runId:id,sequence:1,type:'run.started' as const,occurredAt:'2026-10-10T00:00:00.000Z',payload:{}};send({kind:'run.event',id,input},2000);
 const hb={...input,eventId:randomUUID(),sequence:2,type:'run.heartbeat' as const};send({kind:'run.event',id,input:hb},62001);
 expect(()=>send({kind:'run.close',id,input:{expectedVersion:2,reason:'race'}},62001)).toThrow('version_conflict');expect(()=>send({kind:'run.close',id,input:{expectedVersion:3,reason:'race'}},62001)).toThrow('run_not_stale');
 send({kind:'run.close',id,input:{expectedVersion:3,reason:'race'}},122002);expect(()=>send({kind:'run.event',id,input:{...hb,eventId:randomUUID(),sequence:3}},122002)).toThrow('run_terminal');
 const history=owned.store.snapshot({kind:'events',id,input:{limit:50}},122002).body.data as {items:{type:string}[]};expect(history.items.map(x=>x.type)).toEqual(['run.started','run.heartbeat']);
 }finally{owned.close();}
});
