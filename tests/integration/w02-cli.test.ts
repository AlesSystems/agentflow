import { randomUUID } from "node:crypto";
import { readFileSync,readdirSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect,it } from "vitest";
import { launch,pair } from "../fixtures/server";
import { cliFixture } from "../fixtures/p06-cli";
import { canonicalDigest } from "../../src/domain/request-digest";

it("delivers actual CLI artifacts and gate decisions through durable outage recovery with original ACK joins",async()=>{
 let server=await launch();const f=cliFixture(server);let cookie=await pair(server);const transcript:unknown[]=[];
 const call=async(path:string,input?:unknown,method=input?"POST":"GET",human=false)=>{const response=await fetch(server.url+"/api/v1"+path,{method,headers:{...(human?{Cookie:cookie,Origin:server.url}:{Authorization:"Bearer "+server.credentials().reporterToken}),"Content-Type":"application/json","Idempotency-Key":randomUUID()},...(input?{body:JSON.stringify(input)}:{})});const body=await response.json();transcript.push({path,input,status:response.status,body});expect(response.ok).toBe(true);return body;};
 const cli=async(args:string[],code=0)=>{const result=await f.cli(args);transcript.push({args:args.filter(a=>!a.startsWith(f.dir)),...result});expect(result.code).toBe(code);return result;};
 const register=async(args:string[],body:unknown)=>JSON.parse((await cli([...args,"--file",f.file(body),"--idempotency-key",randomUUID()])).stdout).id as string;
 const current=async(id:string)=>(await call("/tasks/"+id)).data;
 const outage=async(runId:string,payload:unknown)=>{
  await server.stop();await cli(["report","--run",runId,"--type","run.succeeded","--payload",f.file(payload)],2);
  const directory=join(f.env.AGENTFLOW_OUTBOX_DIR,runId),name=readdirSync(directory).find(n=>/^2-/.test(n))!;
  const original=JSON.parse(readFileSync(join(directory,name),"utf8"));transcript.push({original});
  server=await launch({dir:server.dir,port:server.port});cookie=await pair(server);
  const ack=JSON.parse((await cli(["flush","--run",runId])).stdout);expect(ack).toMatchObject({eventId:original.body.eventId,runId,acceptedSequence:2});
  const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{
   const row=db.prepare("SELECT event_id,run_id,sequence,digest,acknowledgement FROM run_events WHERE event_id=?").get(ack.eventId) as {acknowledgement:string;digest:string};
   expect(row).toMatchObject({event_id:ack.eventId,run_id:runId,sequence:2,digest:canonicalDigest(original.body)});expect(JSON.parse(row.acknowledgement).data).toMatchObject({eventId:ack.eventId,acceptedSequence:2});transcript.push({joined:row});
   const before=db.prepare("SELECT count(*) n FROM gate_decisions").get();
   const replay=await call("/runs/"+runId+"/events",original.body);expect(replay.data.eventId).toBe(ack.eventId);expect(db.prepare("SELECT count(*) n FROM gate_decisions").get()).toEqual(before);
  }finally{db.close();}
  await cli(["flush","--run",runId]);return ack;
 };
 try{
  const projectId=await register(["project","create"],{name:"Synthetic W02 CLI"});
  const taskId=await register(["task","create"],{projectId,title:"Reported CLI evidence"});
  const agentId=await register(["agent","register"],{displayName:"Synthetic",source:"CLI",defaultRole:"implementation"});
  await call("/tasks/"+taskId+"/review-policy",{expectedVersion:1,reviewRequired:true,verificationRequired:true},"PATCH",true);
  const runId=await register(["run","register"],{id:randomUUID(),projectId,taskId,agentId,purpose:"implementation",expectedTaskVersion:(await current(taskId)).task.version});
  await cli(["report","--run",runId,"--type","run.started","--payload",f.file({})]);await outage(runId,{summary:"implementation done",artifactRef:"synthetic:CLI",displayUrl:"https://example.com/inert"});
  expect(await current(taskId)).toMatchObject({task:{workRevision:2,status:"review"},evidence:{currentArtifact:{artifactRef:"synthetic:CLI",runId}}});
  for(const [purpose,decision] of [["review","changes_requested"],["review","approved"],["verification","approved"]] as const){
   const t=(await current(taskId)).task;
   const gate=await register(["run","register"],{id:randomUUID(),projectId,taskId,agentId,purpose,expectedTaskVersion:t.version,workRevision:t.workRevision,artifactRef:"synthetic:CLI",reworkRound:t.reworkRound});
   await cli(["report","--run",gate,"--type","run.started","--payload",f.file({})]);
   if(decision==="changes_requested")await outage(gate,{summary:"review reported",decision,evidenceNote:"Synthetic explicit negative"});
   else await cli(["report","--run",gate,"--type","run.succeeded","--payload",f.file({summary:"gate reported",decision,evidenceNote:"Synthetic approval"})]);
  }
  expect(await current(taskId)).toMatchObject({evidence:{review:{approved:true,changesRequested:true},verification:{approved:true,changesRequested:false}}});
  const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT count(*) n FROM gate_decisions").get()).toEqual({n:3});expect(db.prepare("SELECT count(*) n FROM task_artifacts").get()).toEqual({n:1});transcript.push({decisions:db.prepare("SELECT * FROM gate_decisions").all(),artifacts:db.prepare("SELECT * FROM task_artifacts").all()});}finally{db.close();}
 }finally{if(process.env.AGENTFLOW_W02_EVIDENCE_DIR)writeFileSync(join(process.env.AGENTFLOW_W02_EVIDENCE_DIR,"cli-transcript.json"),JSON.stringify({dir:server.dir,outbox:f.env.AGENTFLOW_OUTBOX_DIR,transcript},null,2),{mode:0o600});await server.stop();}
},30000);
