import { randomUUID } from 'node:crypto';
import { expect,it } from 'vitest';
import { launch,pair } from '../fixtures/server';
it('persists real HTTP commands, rejects forged acceptance and returns original receipts',async()=>{
 let server=await launch();
 try{
 let cookie=await pair(server);
 const call=(path:string,method='GET',input?:unknown,key=randomUUID(),reporter=false)=>fetch(server.url+'/api/v1'+path,{method,headers:{...(reporter?{Authorization:'Bearer '+server.credentials().reporterToken}:{Cookie:cookie,Origin:server.url}),'Content-Type':'application/json','Idempotency-Key':key},...(input===undefined?{}:{body:JSON.stringify(input)})});
 const response=await call('/projects','POST',{name:'Synthetic HTTP project'});expect(response.status).toBe(201);
 const projectId=(await response.json()).data.id;
 const key=randomUUID();const input={projectId,title:'Synthetic task'};
 const created=await call('/tasks','POST',input,key);expect(created.status).toBe(201);const receipt=await created.json();const id=receipt.data.id;
 expect((await call('/tasks/'+id,'PATCH',{expectedVersion:1,status:'review'})).status).toBe(200);
 const forged=await call('/tasks/'+id+'/complete','POST',{expectedVersion:2,evidenceNote:'Synthetic test'},randomUUID(),true);expect(forged.status).toBe(403);expect(forged.headers.get('AgentFlow-Generation')).toBe(receipt.generation);
 const complete=await call('/tasks/'+id+'/complete','POST',{expectedVersion:2,evidenceNote:'Synthetic browser acceptance fixture'});expect(complete.status).toBe(201);
 expect((await call('/tasks/'+id+'/comments','POST',{text:'immutable comment'})).status).toBe(201);
 expect((await (await call('/tasks/'+id)).json()).data.task).toMatchObject({version:3,workRevision:1,status:'completed'});
 const writes=await Promise.all([call('/tasks/'+id+'/reopen','POST',{expectedVersion:3,reason:'synthetic A'}),call('/tasks/'+id+'/reopen','POST',{expectedVersion:3,reason:'synthetic B'})]);expect(writes.map(r=>r.status).sort()).toEqual([200,409]);
 const dir=server.dir;await server.stop();server=await launch({dir});cookie=await pair(server);
 const retry=await call('/tasks','POST',input,key);expect(retry.status).toBe(201);expect(await retry.json()).toEqual(receipt);
 const altered=await call('/tasks','POST',{...input,title:' Synthetic task '},key);expect(altered.status).toBe(409);
 const unknownKey=randomUUID();expect((await call('/tasks','POST',{...input,actor:'operator'},unknownKey)).status).toBe(422);expect((await call('/tasks','POST',input,unknownKey)).status).toBe(201);
 }finally{await server.stop();}
},60000);
