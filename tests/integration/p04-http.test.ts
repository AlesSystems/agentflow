import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { launch,pair } from '../fixtures/server';
it('serializes concurrent public registrations and recovers original identity after mutable state and restart',async()=>{
 let server=await launch();
 try {
 let cookie=await pair(server);
 const call=(path:string,input?:unknown,key=randomUUID(),method=input?'POST':'GET',human=false)=>fetch(server.url+'/api/v1'+path,{method,headers:{...(human?{Cookie:cookie,Origin:server.url}:{Authorization:'Bearer '+server.credentials().reporterToken}),'Content-Type':'application/json','Idempotency-Key':key},...(input?{body:JSON.stringify(input)}:{})});
 const create=async(path:string,input:unknown)=>{const response=await call(path,input);expect(response.status).toBe(201);return (await response.json()).data.id as string;};
 const projectId=await create('/projects',{name:'Synthetic P04 HTTP'});
 const taskId=await create('/tasks',{projectId,title:'Concurrent ownership'});
 const agentId=await create('/agents',{displayName:'Synthetic',source:'subprocess',defaultRole:'implementation'});
 const inputs=[0,1].map(()=>({id:randomUUID(),projectId,taskId,agentId,purpose:'implementation',expectedTaskVersion:1}));
 const responses=await Promise.all(inputs.map(input=>call('/runs',input)));
 expect(responses.map(r=>r.status).sort()).toEqual([201,409]);
 const winner=responses.findIndex(r=>r.status===201);
 const registration=await responses[winner].json();
 const runId=inputs[winner].id;
 const db=new Database(join(server.dir,'agentflow.sqlite'),{readonly:true});
 try {expect(db.prepare('SELECT version,work_revision FROM tasks WHERE id=?').get(taskId)).toEqual({version:2,work_revision:2});expect(db.prepare('SELECT last_value FROM run_order_allocator').get()).toEqual({last_value:1});for(const table of ['runs','run_registrations'])expect(db.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:1});expect(db.prepare('SELECT count(*) n FROM changes').get()).toEqual({n:5});expect(db.prepare('SELECT count(*) n FROM receipts').get()).toEqual({n:4});} finally{db.close();}
 const started={schemaVersion:1,eventId:randomUUID(),runId,sequence:1,type:'run.started',occurredAt:'2099-01-01T00:00:00Z',payload:{}};
 const ack=await call(`/runs/${runId}/events`,started);expect(ack.status).toBe(201);const originalAck=await ack.json();
 const retry=await call('/runs',inputs[winner]);expect(retry.status).toBe(200);expect(await retry.json()).toEqual(registration);
 expect((await call('/runs',{...inputs[winner],model:'changed'})).status).toBe(409);
 const dir=server.dir;await server.stop();server=await launch({dir});cookie=await pair(server);
 const restarted=await call('/runs',inputs[winner]);expect(restarted.status).toBe(200);expect(await restarted.json()).toEqual(registration);
 const duplicate=await call(`/runs/${runId}/events`,started);expect(duplicate.status).toBe(200);expect(await duplicate.json()).toEqual(originalAck);
 const read=await call('/runs/'+runId);expect(read.status).toBe(200);expect((await read.json()).data).toMatchObject({state:'running',version:2,lastSequence:1});
 expect((await call(`/runs/${runId}/close`,{expectedVersion:2,reason:'forged'})).status).toBe(403);
 expect((await call(`/runs/${runId}/close`,{expectedVersion:2,reason:'fresh'},randomUUID(),'POST',true)).status).toBe(409);
 } finally{await server.stop();}
});
