import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync,readdirSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect,it } from "vitest";
import { launch,pair } from "../fixtures/server";
import { cliFixture } from "../fixtures/p06-cli";
import { openOwnedStore } from "../../src/db";
import { restore } from "../../src/db/recovery";
const base=process.env.AGENTFLOW_W02_W01_SOURCE;
const upgrade=base?it:it.skip;
upgrade("upgrades an actual stopped W01 producer fixture without rewriting old ACKs or pending outbox",async()=>{
 if(!base)throw new Error("W01 source prerequisite missing");
 let server=await launch({cwd:base});const f=cliFixture(server);const transcript:unknown[]=[];let cookie=await pair(server);
 const call=async(path:string,input?:unknown,method=input?"POST":"GET",human=false,key=randomUUID())=>{const r=await fetch(server.url+"/api/v1"+path,{method,headers:{...(human?{Cookie:cookie,Origin:server.url}:{Authorization:"Bearer "+server.credentials().reporterToken}),"Content-Type":"application/json","Idempotency-Key":key},...(input?{body:JSON.stringify(input)}:{})});const body=await r.json();transcript.push({path,input,key,status:r.status,body,generation:r.headers.get("AgentFlow-Generation")});expect(r.ok).toBe(true);return body;};
 const cli=async(cwd:string,args:string[],expected=0)=>{
  const child=spawn(process.execPath,["--import","tsx","src/cli/main.ts",...args],{cwd,env:{...process.env,...f.env},stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);const code=await new Promise<number|null>(resolve=>child.once("close",resolve));transcript.push({cwd,args,code,stdout,stderr});expect(code).toBe(expected);return stdout;
 };
 const register=async(args:string[],body:unknown,key=randomUUID())=>JSON.parse(await cli(base,[...args,"--file",f.file(body),"--idempotency-key",key])).id as string;
 const current=async(id:string)=>(await call("/tasks/"+id)).data;
 const snapshot=()=>{const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{return {receipts:db.prepare("SELECT * FROM receipts ORDER BY principal,method,path,key").all(),registrations:db.prepare("SELECT * FROM run_registrations ORDER BY run_id").all(),events:db.prepare("SELECT * FROM run_events ORDER BY event_id").all()};}finally{db.close();}};
 try{
  const projectId=await register(["project","create"],{name:"Synthetic W01 upgrade"});
  const agentId=await register(["agent","register"],{displayName:"Synthetic old producer",source:"CLI",defaultRole:"implementation"});
  const taskBody={projectId,title:"Old receipt task"},taskKey=randomUUID();
  const taskReceipt=await call("/tasks",taskBody,"POST",false,taskKey),taskId=taskReceipt.data.id;
  const implementation={id:randomUUID(),projectId,agentId,taskId,purpose:"implementation",expectedTaskVersion:1};
  await register(["run","register"],implementation);
  const registrationReceipt=await call("/runs",implementation);
  for(const [type,payload] of [["run.started",{}],["run.succeeded",{summary:"Old implementation success"}]] as const)await cli(base,["report","--run",implementation.id,"--type",type,"--payload",f.file(payload)]);
  const review={id:randomUUID(),projectId,agentId,taskId,purpose:"review",expectedTaskVersion:(await current(taskId)).task.version};
  await register(["run","register"],review);await cli(base,["report","--run",review.id,"--type","run.started","--payload",f.file({})]);await cli(base,["report","--run",review.id,"--type","run.succeeded","--payload",f.file({summary:"Legacy review success"})]);
  const manual=await register(["task","create"],{projectId,title:"Old manual acceptance"});
  await call("/tasks/"+manual,{expectedVersion:1,status:"review"},"PATCH");
  const completeBody={expectedVersion:2,evidenceNote:"Synthetic W01 browser-role acceptance"},completeKey=randomUUID();
  const completionReceipt=await call("/tasks/"+manual+"/complete",completeBody,"POST",true,completeKey);
  const old=snapshot();
  const pending={id:randomUUID(),projectId,agentId,purpose:"planning"};const pendingKey=randomUUID();
  await server.stop();await cli(base,["run","register","--file",f.file(pending),"--idempotency-key",pendingKey],2);
  const pendingName=readdirSync(f.env.AGENTFLOW_OUTBOX_DIR).find(name=>name===`registration-${pendingKey}.json`)!;const pendingOriginal=readFileSync(join(f.env.AGENTFLOW_OUTBOX_DIR,pendingName),"utf8");transcript.push({pendingOriginal});
  server=await launch({dir:server.dir,port:server.port});cookie=await pair(server);
  const after=snapshot();const projectedEvents=(after.events as Record<string,unknown>[]).map(row=>{expect(row.payload_pruned_at).toBe(null);return Object.fromEntries(Object.keys((old.events as Record<string,unknown>[])[0]).map(key=>[key,row[key]]));});expect({...after,events:projectedEvents}).toEqual(old);
  const detail=await current(taskId);expect(detail).toMatchObject({task:{reviewRequired:false,verificationRequired:false,reworkRound:0},evidence:{currentArtifact:null,review:{approved:false},verification:{approved:false},implementationCurrent:true}});
  expect(await call("/tasks",taskBody,"POST",false,taskKey)).toEqual(taskReceipt);
  expect(JSON.parse(await cli(process.cwd(),["task","create","--file",f.file(taskBody),"--idempotency-key",taskKey])).id).toBe(taskId);
  expect(await call("/runs",implementation)).toEqual(registrationReceipt);
  expect(JSON.parse(await cli(process.cwd(),["run","register","--file",f.file(implementation),"--idempotency-key",randomUUID()])).id).toBe(implementation.id);
  expect(await call("/tasks/"+manual+"/complete",completeBody,"POST",true,completeKey)).toEqual(completionReceipt);
  await cli(process.cwd(),["flush"]);expect(readdirSync(f.env.AGENTFLOW_OUTBOX_DIR).includes(pendingName)).toBe(false);
  const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{
   expect(db.prepare("SELECT count(*) n FROM runs WHERE id=?").get(pending.id)).toEqual({n:1});expect(db.prepare("SELECT count(*) n FROM gate_decisions").get()).toEqual({n:0});expect(db.prepare("SELECT count(*) n FROM task_artifacts").get()).toEqual({n:0});expect(db.prepare("SELECT artifact_ref,rework_round FROM runs WHERE id=?").get(review.id)).toEqual({artifact_ref:null,rework_round:null});expect(db.prepare("SELECT schema_version FROM instance_metadata").get()).toEqual({schema_version:12});
   for(const row of old.registrations as {run_id:string;body:string}[])expect((db.prepare("SELECT body FROM run_registrations WHERE run_id=?").get(row.run_id) as {body:string}).body).toBe(row.body);
   transcript.push({legacyRows:old,upgraded:snapshot()});
  }finally{db.close();}
  await server.stop();const owned=await openOwnedStore(server.dir);const backup=join(server.dir,"backups","w02-upgraded.sqlite");await owned.store.backup(backup);const generation=owned.store.metadata().generation;owned.close();await restore(server.dir,backup);
  server=await launch({dir:server.dir,port:server.port});cookie=await pair(server);
  expect(await current(taskId)).toMatchObject({evidence:{currentArtifact:null,review:{approved:false},implementationCurrent:true}});
  const replay=await fetch(server.url+"/api/v1/tasks/"+manual+"/complete",{method:"POST",headers:{Cookie:cookie,Origin:server.url,"Content-Type":"application/json","Idempotency-Key":completeKey},body:JSON.stringify(completeBody)});expect(replay.status).toBe(201);expect(await replay.json()).toEqual(completionReceipt);expect(replay.headers.get("AgentFlow-Generation")).not.toBe(generation);
  transcript.push({postRestore:snapshot()});
 }finally{if(process.env.AGENTFLOW_W02_EVIDENCE_DIR)writeFileSync(join(process.env.AGENTFLOW_W02_EVIDENCE_DIR,"upgrade-transcript.json"),JSON.stringify({base,dir:server.dir,outbox:f.env.AGENTFLOW_OUTBOX_DIR,transcript},null,2),{mode:0o600});await server.stop();}
},60000);
