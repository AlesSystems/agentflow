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
it('guards event identity lookup with authentication, strict envelopes and atomic contention rejection',async()=>{
 const server=await launch();let writer:Database.Database|undefined;
 try {
 const cookie=await pair(server);const auth={Authorization:'Bearer '+server.credentials().reporterToken,'Content-Type':'application/json'};
 const call=(path:string,input?:unknown,headers:Record<string,string>=auth,method=input?'POST':'GET')=>fetch(server.url+'/api/v1'+path,{method,headers:{...headers,'Idempotency-Key':randomUUID()},...(input?{body:JSON.stringify(input)}:{})});
 const create=async(path:string,input:unknown)=>{const r=await call(path,input);expect(r.status).toBe(201);return (await r.json()).data.id as string;};
 const projectId=await create('/projects',{name:'Synthetic guards'}),taskId=await create('/tasks',{projectId,title:'Synthetic guards'}),agentId=await create('/agents',{displayName:'Synthetic',source:'fixture',defaultRole:'implementation'}),runId=randomUUID();
 expect((await call('/runs',{id:runId,projectId,taskId,agentId,purpose:'implementation',expectedTaskVersion:1})).status).toBe(201);
 const input={schemaVersion:1,eventId:randomUUID(),runId,sequence:1,type:'run.started',occurredAt:'2026-10-10T00:00:00Z',payload:{}};const path=`/runs/${runId}/events`;
 const accepted=await call(path,input);expect(accepted.status).toBe(201);const ack=await accepted.json();
 const facts=()=>{const db=new Database(join(server.dir,'agentflow.sqlite'),{readonly:true});try{return Object.fromEntries(['runs','tasks','run_events','changes','receipts','run_order_allocator'].map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));}finally{db.close();}};
 const before=facts();
 for(const [body,headers,status,code] of [
 [input,{'Content-Type':'application/json'},401,'authentication_required'],
 [input,{...auth,Authorization:'Bearer invalid'},401,'authentication_required'],
 [input,{...auth,Origin:'https://evil.example'},403,'origin_rejected'],
 [{...input,schemaVersion:2},auth,422,'unsupported_schema_version'],
 [{...input,unknown:true},auth,422,'validation_failed'],
 [{...input,runId:randomUUID()},auth,422,'validation_failed'],
 [{...input,payload:{unexpected:true}},auth,422,'validation_failed'],
 [{...input,occurredAt:'2026-10-11T00:00:00Z'},auth,409,'idempotency_conflict'],
 ] as [unknown,Record<string,string>,number,string][]){const r=await call(path,body,headers);expect(r.status).toBe(status);const error=await r.json();expect(error.error.code).toBe(code);expect(facts()).toEqual(before);}
 const changedRoute=await call(`/runs/${randomUUID()}/events`,{...input,runId:randomUUID()});expect(changedRoute.status).toBe(422);
 const otherId=randomUUID();await call('/runs',{id:otherId,projectId,agentId,purpose:'planning'});const beforeGlobal=facts();const collision=await call(`/runs/${otherId}/events`,{...input,runId:otherId});expect(collision.status).toBe(409);expect((await collision.json()).error.code).toBe('idempotency_conflict');expect(facts()).toEqual(beforeGlobal);
 const gap=await call(path,{...input,eventId:randomUUID(),sequence:4});expect(gap.status).toBe(409);expect((await gap.json()).error.details).toEqual({expectedSequence:2});
 const unknownId=randomUUID();expect((await call(`/runs/${unknownId}/events`,{...input,eventId:randomUUID(),runId:unknownId})).status).toBe(404);
 const reordered=Object.fromEntries(Object.entries(input).reverse());const exact=await call(path,reordered);expect(exact.status).toBe(200);expect(await exact.json()).toEqual(ack);
 expect((await call(path,input,{...auth,'Content-Type':'text/plain'})).status).toBe(415);
 const oversized=await fetch(server.url+'/api/v1'+path,{method:'POST',headers:auth,body:'x'.repeat(70000)});expect(oversized.status).toBe(413);
 const query=await call(path+'?x=1',input);expect(query.status).toBe(400);
 expect((await call('/runs?limit=101')).status).toBe(400);expect((await call('/runs?limit=1&limit=2')).status).toBe(400);
 writer=new Database(join(server.dir,'agentflow.sqlite'));writer.exec('BEGIN IMMEDIATE');const lockedBefore=facts();
 const blocked=await call(path,{...input,eventId:randomUUID(),sequence:2,type:'run.heartbeat'});expect(blocked.status).toBe(503);expect(blocked.headers.get('Retry-After')).toBe('1');expect(facts()).toEqual(lockedBefore);writer.exec('ROLLBACK');writer.close();writer=undefined;
 const burst:Response[]=[];for(let batch=0;batch<7;batch++)burst.push(...await Promise.all(Array.from({length:50},()=>call(path,{}))));expect(burst.filter(r=>r.status===429).length).toBeGreaterThan(0);for(const r of burst.filter(r=>r.status===429))expect(r.headers.get('Retry-After')).toBe('1');expect(facts()).toEqual(lockedBefore);
 const expired=new Database(join(server.dir,'agentflow.sqlite'));expired.prepare('UPDATE sessions SET expires_at=0').run();expired.close();expect((await call(path,input,{Cookie:cookie,Origin:server.url,'Content-Type':'application/json'})).status).toBe(401);
 }finally{if(writer){writer.exec('ROLLBACK');writer.close();}await server.stop();}
},60000);
