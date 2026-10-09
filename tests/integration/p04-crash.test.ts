import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { launch } from '../fixtures/server';
for(const mode of ['before','after'] as const)for(const operation of ['registration','start','heartbeat','success'] as const)it(`recovers ${operation} after real SIGKILL ${mode} commit`,async()=>{
 const key=randomUUID();let server=await launch({entry:'tests/fixtures/crash-server.ts',extraEnv:{AGENTFLOW_TEST_KEY:key,AGENTFLOW_TEST_CRASH:mode}});
 try {
 const call=(path:string,input:unknown,identity=randomUUID())=>fetch(server.url+'/api/v1'+path,{method:'POST',headers:{Authorization:'Bearer '+server.credentials().reporterToken,'Content-Type':'application/json','Idempotency-Key':identity},body:JSON.stringify(input)});
 const create=async(path:string,input:unknown)=>{const r=await call(path,input);expect(r.status).toBe(201);return (await r.json()).data.id as string;};
 const projectId=await create('/projects',{name:'Synthetic crash'});const taskId=await create('/tasks',{projectId,title:'Synthetic crash'});const agentId=await create('/agents',{displayName:'Synthetic',source:'fixture',defaultRole:'implementation'});const runId=randomUUID();
 const registration={id:runId,projectId,taskId,agentId,purpose:'implementation',expectedTaskVersion:1};
 const event=(type:string,sequence:number,payload:unknown={})=>({schemaVersion:1,eventId:randomUUID(),runId,sequence,type,occurredAt:'2099-01-01T00:00:00Z',payload});
 if(operation!=='registration'){expect((await call('/runs',registration)).status).toBe(201);}
 if(operation==='heartbeat'||operation==='success')expect((await call(`/runs/${runId}/events`,event('run.started',1))).status).toBe(201);
 const input=operation==='registration'?registration:event(operation==='start'?'run.started':operation==='heartbeat'?'run.heartbeat':'run.succeeded',operation==='start'?1:2,operation==='success'?{summary:'Synthetic finished'}:{});
 const path=operation==='registration'?'/runs':`/runs/${runId}/events`;
 const dir=server.dir;
 const inspect=()=>{const db=new Database(join(dir,'agentflow.sqlite'),{readonly:true});try{return {runs:db.prepare('SELECT state,version,last_sequence,registration_order FROM runs').all(),task:db.prepare('SELECT status,version,work_revision FROM tasks').get(),counts:Object.fromEntries(['run_events','run_registrations','receipts','changes'].map(t=>[t,(db.prepare(`SELECT count(*) n FROM ${t}`).get() as {n:number}).n])),allocator:db.prepare('SELECT last_value FROM run_order_allocator').get()};}finally{db.close();}};
 const before=inspect();await expect(call(path,input,key)).rejects.toThrow();await server.stop();expect(server.child.signalCode).toBe('SIGKILL');
 const killed=inspect();if(mode==='before')expect(killed).toEqual(before);else{
 const registered=operation==='registration';expect(killed.counts.run_events).toBe(before.counts.run_events+(registered?0:1));expect(killed.counts.run_registrations).toBe(before.counts.run_registrations+(registered?1:0));expect(killed.counts.receipts).toBe(before.counts.receipts+(registered?1:0));expect(killed.counts.changes).toBe(before.counts.changes+(registered||operation==='start'||operation==='success'?3-(registered?1:0):2));
 }
 server=await launch({dir});const recovered=await call(path,input,key);expect(recovered.status).toBe(operation==='registration'?201:mode==='after'?200:201);const body=await recovered.json();const recoveredFacts=inspect();
 const exact=await call(path,input,key);expect(await exact.json()).toEqual(body);expect(inspect()).toEqual(recoveredFacts);
 expect(recoveredFacts.runs).toEqual([{state:operation==='registration'?'queued':operation==='success'?'succeeded':'running',version:operation==='registration'?1:operation==='start'?2:3,last_sequence:operation==='registration'?0:operation==='start'?1:2,registration_order:1}]);
 expect(recoveredFacts.task).toEqual({status:operation==='registration'?'backlog':operation==='success'?'review':'in_progress',version:operation==='registration'?2:operation==='success'?4:3,work_revision:2});
 if(mode==='after')expect(recoveredFacts).toEqual(killed);
 }finally{await server.stop();}
},60000);
