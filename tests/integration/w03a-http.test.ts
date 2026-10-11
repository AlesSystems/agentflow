import { createServer } from "node:http";
import { mkdtempSync,realpathSync,writeFileSync,mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { expect,it } from "vitest";
import { launch,pair,stop } from "../fixtures/server";
it("enforces human-only public routes, local reads, replay, lost callers, crash recovery and shutdown finalization",async()=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),"w03a-http-"));const credential=join(dir,"token.json");writeFileSync(credential,JSON.stringify({token:"SYNTHETIC_TOKEN"}),{mode:0o600});
 const proof=process.env.W03A_PROOF_DIR ?? join(dir,"proof");mkdirSync(proof,{recursive:true,mode:0o700});const wires:unknown[]=[];const commands:unknown[]=[];const sql:unknown[]=[];
 let calls=0;let waiting=false;let release=()=>{};let arrived=()=>{};let observation=new Promise<void>(resolve=>{arrived=resolve;});
 const remote=createServer(async(req,res)=>{calls++;wires.push({ordinal:calls,receivedAt:Date.now(),method:req.method,url:req.url,accept:req.headers.accept,version:req.headers["x-github-api-version"],bearerPresent:!!req.headers.authorization});expect(req.method).toBe("GET");if(waiting){arrived();await new Promise<void>(resolve=>{release=resolve;});}res.end(JSON.stringify([{number:9,html_url:"https://github.com/a/b/pull/9",title:"Synthetic private title",state:"open",draft:false,head:{sha:"a".repeat(40)},base:{ref:"main"},merged_at:null,body:"DISCARDED_BODY"}]));});
 await new Promise<void>(resolve=>remote.listen(0,"127.0.0.1",resolve));const target=`http://127.0.0.1:${(remote.address() as {port:number}).port}`;
 const options={dir:join(dir,"data"),entry:"tests/fixtures/w03a-server.ts",extraEnv:{AGENTFLOW_GITHUB_TOKEN_FILE:credential,W03A_FIXTURE_ORIGIN:target}};
 let server=await launch(options);let cookie=await pair(server);
 const command=async(path:string,body:unknown,key=randomUUID(),principal="human")=>{
  const response=await fetch(server.url+"/api/v1/connections/github"+path,{method:path==="/repositories"?"PUT":"POST",headers:{Origin:server.url,"Content-Type":"application/json","Idempotency-Key":key,...(principal==="human"?{Cookie:cookie}:{Authorization:"Bearer "+server.credentials().reporterToken})},body:JSON.stringify(body)});const result={status:response.status,body:await response.json()};commands.push({path,body,key,principal,result});return result;
 };
 try{
  expect((await fetch(server.url+"/api/v1/connections/github")).status).toBe(401);
  expect((await fetch(server.url+"/api/v1/connections/github",{headers:{Authorization:"Bearer "+server.credentials().reporterToken}})).status).toBe(403);
  expect((await command("/refresh",{expectedVersion:1,repository:"a/b",page:1})).status).toBe(409);expect(calls).toBe(0);
  const configuration={expectedVersion:1,enabled:true,repositories:["a/b"]};const configurationKey=randomUUID();expect((await command("/repositories",configuration,configurationKey)).status).toBe(200);
  const refresh={expectedVersion:2,repository:"a/b",page:1};const key=randomUUID();const result=await command("/refresh",refresh,key);expect(result).toMatchObject({status:200,body:{data:{outcome:"fetched",count:1}}});expect(calls).toBe(1);
  expect(await command("/refresh",refresh,key)).toEqual(result);expect((await command("/refresh",refresh,key,"reporter")).status).toBe(403);expect((await command("/refresh",{...refresh,page:2},key)).status).toBe(409);
  for(let n=0;n<3;n++)expect((await fetch(server.url+"/api/v1/connections/github",{headers:{Cookie:cookie}})).status).toBe(200);expect(calls).toBe(1);
  waiting=true;observation=new Promise<void>(resolve=>{arrived=resolve;});const lostKey=randomUUID();const controller=new AbortController();
  const lost=fetch(server.url+"/api/v1/connections/github/refresh",{method:"POST",headers:{Cookie:cookie,Origin:server.url,"Content-Type":"application/json","Idempotency-Key":lostKey},body:JSON.stringify(refresh),signal:controller.signal}).catch(()=>null);await observation;controller.abort();await lost;release();
  await new Promise(resolve=>setTimeout(resolve,50));expect((await command("/refresh",refresh,lostKey)).body.data.outcome).toBe("fetched");expect(calls).toBe(2);
  observation=new Promise<void>(resolve=>{arrived=resolve;});const crashKey=randomUUID();const crashed=command("/refresh",refresh,crashKey).catch(()=>null);await observation;await stop(server.child,"SIGKILL");release();await crashed;
  server=await launch(options);cookie=await pair(server);expect((await command("/refresh",refresh,crashKey)).body.data).toMatchObject({outcome:"interrupted",error:"interrupted"});expect(calls).toBe(3);
  observation=new Promise<void>(resolve=>{arrived=resolve;});const shutdownKey=randomUUID();const pending=command("/refresh",refresh,shutdownKey).catch(()=>null);await observation;const start=Date.now();await server.stop();expect(Date.now()-start).toBeLessThan(5000);release();await pending;
  const db=new Database(join(options.dir,"agentflow.sqlite"),{readonly:true});try{
   expect(db.prepare("SELECT count(*) AS n FROM github_refresh_intents WHERE state='pending'").get()).toEqual({n:0});
   const receipt=db.prepare("SELECT body FROM receipts WHERE key=?").get(shutdownKey) as {body:string};expect(JSON.parse(receipt.body).data).toMatchObject({outcome:"interrupted",error:"interrupted"});
   sql.push({pending:db.prepare("SELECT count(*) AS n FROM github_refresh_intents WHERE state='pending'").get(),cache:db.prepare("SELECT * FROM github_pull_requests").all(),intents:db.prepare("SELECT * FROM github_refresh_intents").all(),receipts:db.prepare("SELECT principal,method,path,key,digest,status,body FROM receipts").all(),changes:db.prepare("SELECT * FROM changes").all()});
   const serialized=JSON.stringify(db.prepare("SELECT * FROM github_pull_requests").all())+JSON.stringify(db.prepare("SELECT * FROM receipts").all())+JSON.stringify(db.prepare("SELECT * FROM changes").all());expect(serialized).not.toMatch(/SYNTHETIC_TOKEN|DISCARDED_BODY/);
   expect(db.prepare("SELECT DISTINCT entity_id FROM changes WHERE entity_type='github_connection'").all()).toEqual([{entity_id:"github"}]);
  }finally{db.close();}
  expect(server.logs()).not.toMatch(/SYNTHETIC_TOKEN|DISCARDED_BODY|Synthetic private title/);
 }finally{writeFileSync(join(proof,"public-http-evidence.json"),JSON.stringify({dataDir:options.dir,calls,wires,commands,sql,serviceLogs:server.logs()},null,2),{mode:0o600});release();await server.stop();await new Promise<void>(resolve=>{remote.close(()=>resolve());remote.closeAllConnections();});}
},30000);
