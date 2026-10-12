import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRuntime } from "../../src/server/launcher";
import { readConfig } from "../../src/server/config";
import { freePort } from "./server";
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check:()=>boolean,ms=8000){const end=Date.now()+ms;while(!check()){assert(Date.now()<end,"condition deadline");await sleep(20);}}
const dir=mkdtempSync(join(realpathSync(tmpdir()),"w03b-generation-")),port=await freePort(),url=`http://127.0.0.1:${port}`;
const token=join(dir,"token.json");writeFileSync(token,JSON.stringify({token:"SYNTHETIC_ONLY"}),{mode:0o600});
let arrived=()=>{},remoteArrived=()=>{},release=()=>{},holdRemote=false;
const remote=createServer(async(_req,res)=>{if(holdRemote){remoteArrived();await new Promise<void>(resolve=>{release=resolve;});}res.end(JSON.stringify([1,2].map(number=>({number,html_url:"https://github.com/a/b/pull/"+number,title:"Synthetic",state:"open",draft:false,head:{sha:"a".repeat(40)},base:{ref:"main"},merged_at:null}))));});
await new Promise<void>(resolve=>remote.listen(0,"127.0.0.1",resolve));const target=`http://127.0.0.1:${(remote.address() as {port:number}).port}`;
let cleanup:unknown;
const running=await startRuntime(readConfig({...process.env,AGENTFLOW_DATA_DIR:join(dir,"data"),PORT:String(port),AGENTFLOW_GITHUB_TOKEN_FILE:token},"production"),{
 async beforeDispatch(req){if(req.headers["x-test-delay"])arrived();},
 githubTransport:(input,init)=>fetch(String(input).replace("https://api.github.com",target),init),
 async beforeStoreClose(){cleanup={...running.streams.diagnostics(),...running.diagnostics(),history:running.history.diagnostics()};assert.equal(running.streams.diagnostics().leases,0);assert.equal(running.streams.diagnostics().timers,0);assert.equal(running.streams.diagnostics().listeners,0);assert.equal(running.history.diagnostics().leases,0);},
});
const db=new Database(join(running.owned.store.dataDir,"agentflow.sqlite"));
const proof:Record<string,unknown>={buildId:readFileSync(".next/BUILD_ID","utf8"),headers:[]};
let socket:ReturnType<typeof connect>|undefined;
try {
 const paired=await fetch(url+"/api/v1/session",{method:"POST",headers:{Origin:url,"Content-Type":"application/json"},body:JSON.stringify({token:running.owned.credentials.pairingToken})});assert.equal(paired.status,200);const cookie=paired.headers.get("set-cookie")!.split(";")[0];await paired.arrayBuffer();
 const headers={Cookie:cookie,Origin:url,"Content-Type":"application/json"};
 async function command(path:string,input:unknown,key=randomUUID(),method="POST"){const response=await fetch(url+"/api/v1/"+path,{method,headers:{...headers,"Idempotency-Key":key},body:JSON.stringify(input)});return {status:response.status,generation:response.headers.get("agentflow-generation"),body:await response.text()};}
 async function prune(){const p=await command("retention/preview",{cutoff:new Date(Date.now()-1000).toISOString()});assert.equal(p.status,200);const value=JSON.parse(p.body).data;const input={previewId:value.previewId,expectedGeneration:value.expectedGeneration,expectedVersion:value.expectedVersion,candidateDigest:value.candidateDigest};const key=randomUUID(),result=await command("retention/prune",input,key);assert.equal(result.status,200);return {input,key,result};}
 async function delayed(path:string,input:unknown,key:string){let ready!:()=>void;const reached=new Promise<void>(resolve=>{ready=resolve;});arrived=ready;const body=typeof input==="string"?input:JSON.stringify(input);const req=request(url+"/api/v1/"+path,{method:"POST",headers:{...headers,"Idempotency-Key":key,"X-Test-Delay":"1","Content-Length":Buffer.byteLength(body)} });const reply=new Promise<{status:number;generation:string;body:string}>((resolve,reject)=>{req.on("error",reject);req.on("response",res=>{let text="";res.on("data",chunk=>text+=chunk);res.on("end",()=>resolve({status:res.statusCode!,generation:String(res.headers["agentflow-generation"]),body:text}));});});req.flushHeaders();await reached;const old=running.owned.store.metadata().generation;await prune();const current=running.owned.store.metadata().generation;assert.notEqual(current,old);req.end(body);const result=await reply;assert.equal(result.generation,current);(proof.headers as unknown[]).push(result);return result;}
 const key=randomUUID(),input={name:"Synthetic interleaved JSON"};const created=await delayed("projects",input,key);assert.equal(created.status,201);
 const replay=await delayed("projects",input,key);assert.equal(replay.body,created.body);
 const invalid=await delayed("projects","{",randomUUID());assert.equal(invalid.status,400);assert.equal(JSON.parse(invalid.body).error.code,"json_invalid");
 assert.equal((await fetch(url+"/api/v1/projects")).status,401);
 assert.equal((await command("connections/github/repositories",{expectedVersion:1,enabled:true,repositories:["a/b"]},randomUUID(),"PUT")).status,200);
 assert.equal((await command("connections/github/refresh",{expectedVersion:2,repository:"a/b",page:1})).status,200);
 holdRemote=true;let reached!:()=>void;const waiting=new Promise<void>(resolve=>{reached=resolve;});remoteArrived=reached;
 const refreshInput={expectedVersion:2,repository:"a/b",page:1},refreshKey=randomUUID();const pending=command("connections/github/refresh",refreshInput,refreshKey);await waiting;await prune();const current=running.owned.store.metadata().generation;release();const refreshed=await pending;assert.equal(refreshed.status,200);assert.equal(refreshed.generation,current);assert.equal(JSON.parse(refreshed.body).data.outcome,"superseded");
 const historical=await delayed("connections/github/refresh",refreshInput,refreshKey);assert.equal(historical.body,refreshed.body);assert.equal(historical.status,200);
 const conflict=await delayed("connections/github/refresh",{...refreshInput,page:2},refreshKey);assert.equal(conflict.status,409);
 const projectId=JSON.parse(created.body).data.id;
 for(const title of ["Cursor one","Cursor two"])assert.equal((await command("tasks",{projectId,title})).status,201);
 const agent=JSON.parse((await command("agents",{displayName:"Synthetic cursor",source:"fixture",defaultRole:"implementation"})).body).data.id;
 const runId=randomUUID();assert.equal((await command("runs",{id:runId,projectId,agentId:agent,purpose:"planning"})).status,201);
 for(const sequence of [1,2])assert.equal((await command(`runs/${runId}/events`,{schemaVersion:1,eventId:randomUUID(),runId,sequence,type:sequence===1?"run.started":"run.progress",payload:sequence===1?{}:{message:"Synthetic activity cursor"},occurredAt:new Date().toISOString()})).status,201);
 const cursors:Record<string,string>={};
 for(const path of ["tasks","activity","connections/github"]){const response=await fetch(url+"/api/v1/"+path+"?limit=1",{headers:{Cookie:cookie}});assert.equal(response.status,200);cursors[path]=(await response.json()).data.nextCursor;assert(cursors[path],path+" cursor missing");}
 const generation=running.owned.store.metadata().generation;
 db.transaction(()=>{const insert=db.prepare("INSERT INTO changes(entity_type,entity_id,kind,received_at) VALUES('task',?,'updated',0)");for(let i=0;i<20000;i++)insert.run("x".repeat(100));})();
 socket=connect(port,"127.0.0.1");await new Promise<void>(resolve=>socket!.once("connect",resolve));socket.pause();socket.write(`GET /api/v1/changes/stream?after=0&generation=${generation} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${cookie}\r\n\r\n`);
 await until(()=>running.streams.diagnostics().blocked>0);const pressure=running.streams.diagnostics();await prune();await until(()=>running.streams.diagnostics().leases===0);assert(running.streams.diagnostics().stalledCloses>0);assert(performance.now()-pressure.pressureAt<6500);socket.destroy();
 assert.equal(running.streams.diagnostics().timers,0);assert.equal(running.streams.diagnostics().listeners,0);proof.stall={pressure,closed:running.streams.diagnostics()};
 const reset=await fetch(url+`/api/v1/changes/stream?after=0&generation=${generation}`,{headers:{Cookie:cookie}});assert.match(await reset.text(),/event: reset/);assert.equal(reset.headers.get("agentflow-generation"),running.owned.store.metadata().generation);
 for(const [path,cursor] of Object.entries(cursors)){const response=await fetch(url+"/api/v1/"+path+"?limit=1&cursor="+encodeURIComponent(cursor),{headers:{Cookie:cookie}});assert.equal(response.status,400);assert.equal((await response.json()).error.code,"cursor_invalid");}
 const snapshot=await fetch(url+"/api/v1/projects",{headers:{Cookie:cookie}});assert.equal(snapshot.status,200);assert.equal((await snapshot.json()).generation,running.owned.store.metadata().generation);
 const exportResponse=await fetch(url+`/api/v1/export?content=tasks&generation=${generation}`,{headers:{Cookie:cookie}});assert.equal(exportResponse.status,409);await exportResponse.arrayBuffer();
 assert.equal(running.owned.store.sessionCount(),1);running.owned.store.renewGeneration();assert.equal(running.owned.store.sessionCount(),0);assert.equal((await fetch(url+"/api/v1/projects",{headers:{Cookie:cookie}})).status,401);
 db.close();await running.shutdown();proof.cleanup=cleanup;console.log(JSON.stringify(proof));
}catch(error){process.exitCode=1;console.error(error);}finally{release();socket?.destroy();if(db.open)db.close();await running.shutdown();await new Promise<void>(resolve=>{remote.close(()=>resolve());remote.closeAllConnections();});}
