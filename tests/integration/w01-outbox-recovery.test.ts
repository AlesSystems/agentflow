import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import { readFileSync, readdirSync, symlinkSync, renameSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { launch } from "../fixtures/server";
import { workflowCliFixture } from "../fixtures/w01-cli";
import { openOutbox } from "../../src/cli/outbox";
import { createFile, syncDirectory, syncFile } from "../../src/server/filesystem";
for(const phase of ["descriptor-temp","descriptor","record","clear","ack","unlink"])it(`isolates workflow sequence and recovers actual SIGKILL at ${phase}`,async()=>{
 const server=await launch(),f=await workflowCliFixture(server);
 try {
  const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-crash-cli.ts",phase,"report","--workflow-run",f.workflowRunId,"--type","workflow.started","--payload",f.file({})],{env:{...process.env,...f.env},stdio:"ignore"});
  expect(await new Promise(resolve=>child.on("exit",(_code,signal)=>resolve(signal)))).toBe("SIGKILL");
  const directory=join(f.config.outbox,"workflow-runs",f.workflowRunId);
  const before=JSON.parse(readFileSync(join(directory,"state.json"),"utf8"));
  const original=before.pending?.record.body.eventId||readdirSync(directory).find(name=>name.startsWith("1-"))?.slice(2,-5);
  expect((await f.cli(["flush","--workflow-run",f.workflowRunId])).code).toBe(0);
  const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{
   expect(db.prepare("SELECT count(*) n FROM workflow_events").get()).toEqual({n:phase==="descriptor-temp"?0:1});
   expect(db.prepare("SELECT count(*) n FROM run_events").get()).toEqual({n:0});
   if(original)expect(db.prepare("SELECT event_id FROM workflow_events").get()).toEqual({event_id:original});
  }finally{db.close();}
  const state=JSON.parse(readFileSync(join(directory,"state.json"),"utf8"));expect(state.allocatedThrough).toBe(phase==="descriptor-temp"?0:1);expect(state.acknowledgedThrough).toBe(state.allocatedThrough);
  expect(JSON.parse(readFileSync(join(f.config.outbox,f.runId,"state.json"),"utf8"))).toMatchObject({allocatedThrough:0,acknowledgedThrough:0});
 }finally{await server.stop();}
});
it("validates retained workflow namespace and restores descriptor bytes without touching the task producer",async()=>{
 const server=await launch(),f=await workflowCliFixture(server);let fail=true;
 try{
  const outbox=await openOutbox(f.config,performance.now()+5000,{createFile(path,body){if(fail&&/\/1-/.test(path)){fail=false;throw new Error("synthetic workflow record failure");}createFile(path,body);}});
  await expect(outbox.enqueue(f.ref,"workflow.started",{})).rejects.toThrow("synthetic workflow record failure");outbox.close();
  const directory=join(f.config.outbox,"workflow-runs",f.workflowRunId),pending=JSON.parse(readFileSync(join(directory,"state.json"),"utf8"));
  const reopened=await openOutbox(f.config,performance.now()+5000);try{expect((await reopened.next(f.ref))!.body).toEqual(pending.pending.record.body);expect((await reopened.jobs()).map(j=>j.id)).toEqual([`workflow-run:${f.runId}`]);}finally{reopened.close();}
  const namespace=join(f.config.outbox,"workflow-runs"),retained=namespace+"-original";renameSync(namespace,retained);symlinkSync(retained,namespace);
  await expect(openOutbox(f.config,performance.now()+5000)).rejects.toThrow();unlinkSync(namespace);renameSync(retained,namespace);
  expect((await f.cli(["flush"])).code).toBe(0);
 }finally{await server.stop();}
});
it("establishes workflow ACK durability before deleting retained bytes and preserves them on barrier failure",async()=>{
 const server=await launch(),f=await workflowCliFixture(server);
 try{
  const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-fault-cli.ts","ack-dir-sync","report","--workflow-run",f.workflowRunId,"--type","workflow.started","--payload",f.file({})],{env:{...process.env,...f.env},stdio:"ignore"});expect(await new Promise(resolve=>child.on("exit",resolve))).toBe(1);
  const directory=join(f.config.outbox,"workflow-runs",f.workflowRunId),statePath=join(directory,"state.json"),recordPath=join(directory,readdirSync(directory).find(n=>n.startsWith("1-"))!),original=readFileSync(recordPath);
  await expect(openOutbox(f.config,performance.now()+5000,{syncFile(path){if(path===statePath)throw new Error("synthetic durability failure");syncFile(path);}})).rejects.toThrow("synthetic durability failure");expect(readFileSync(recordPath)).toEqual(original);
  const order:string[]=[];const outbox=await openOutbox(f.config,performance.now()+5000,{createFile,renameSync,unlinkSync(path){if(String(path)===recordPath)order.push("unlink");unlinkSync(path);},syncDirectory(path){if(path===directory)order.push("directory");syncDirectory(path);},syncFile(path){if(path===statePath)order.push("file");syncFile(path);}});outbox.close();expect(order.slice(0,3)).toEqual(["file","directory","unlink"]);expect(existsSync(recordPath)).toBe(false);
 }finally{await server.stop();}
});
it("charges workflow bytes to their own producer and includes nested bytes in global accounting",async()=>{
 const {writeFileSync}=await import("node:fs"),{randomUUID}=await import("node:crypto"),{canonicalDigest}=await import("../../src/domain/request-digest");
 const server=await launch(),f=await workflowCliFixture(server);
 try{
  const directory=join(f.config.outbox,"workflow-runs",f.workflowRunId),statePath=join(directory,"state.json"),initial=JSON.parse(readFileSync(statePath,"utf8"));let bytes=Buffer.byteLength(JSON.stringify(initial)),sequence=0;
  while(bytes<10*1024*1024-1000){
   const body={schemaVersion:1,eventId:randomUUID(),workflowRunId:f.workflowRunId,sequence:++sequence,type:sequence===1?"workflow.started":"workflow.succeeded",occurredAt:"2026-10-11T00:00:00.000Z",payload:sequence===1?{}:{summary:"\0".repeat(4000)}};
   const encoded=JSON.stringify({formatVersion:1,producerKind:"workflow-run",body,digest:canonicalDigest(body)});
   if(bytes+Buffer.byteLength(encoded)>10*1024*1024-1000){sequence--;break;}
   writeFileSync(join(directory,`${sequence}-${body.eventId}.json`),encoded,{mode:0o600});bytes+=Buffer.byteLength(encoded);
  }
  const state=JSON.stringify({...initial,allocatedThrough:sequence});writeFileSync(statePath,state,{mode:0o600});bytes+=Buffer.byteLength(state)-Buffer.byteLength(JSON.stringify(initial));
  const last=join(directory,readdirSync(directory).find(n=>n.startsWith(`${sequence}-`))!),original=readFileSync(last);writeFileSync(last,Buffer.concat([original,Buffer.alloc(10*1024*1024-bytes-1,32)]),{mode:0o600});
  const outbox=await openOutbox(f.config,performance.now()+10000);try{
   await expect(outbox.enqueue(f.ref,"workflow.succeeded",{summary:"A new report"})).rejects.toThrow("outbox_full");
   expect((await outbox.enqueue(f.runId,"run.started",{})).body.sequence).toBe(1);
   const jobs=await outbox.jobs();expect(jobs.map(j=>j.id)).toEqual([`run:${f.runId}`,`workflow-run:${f.runId}`]);
  }finally{outbox.close();}
 }finally{await server.stop();}
});
for(const phase of["descriptor-temp","descriptor","registration","clear","authority"])it(`recovers offline workflow-run registration authority SIGKILL at ${phase}`,async()=>{
 const {randomUUID}=await import("node:crypto");const server=await launch(),f=await workflowCliFixture(server);
 try{
  const register=async(args:string[],body:unknown)=>{const r=await f.cli([...args,"--file",f.file(body),"--idempotency-key",randomUUID()]);expect(r.code).toBe(0);return JSON.parse(r.stdout).id as string;};
  const workflowId=await register(["register","workflow"],{id:randomUUID(),projectId:f.projectId,name:"Synthetic registration crash"}),revisionId=await register(["register","workflow-revision","--workflow",workflowId],{id:randomUUID(),expectedWorkflowVersion:1,nodes:[{id:randomUUID(),label:"Node"}],edges:[]});const id=randomUUID(),key=randomUUID(),body={id,workflowId,planRevisionId:revisionId};
  const child=spawn(process.execPath,["--import","tsx","tests/fixtures/w01-registration-crash-cli.ts",phase,"register","workflow-run","--file",f.file(body),"--idempotency-key",key],{env:{...process.env,...f.env},stdio:"ignore"});expect(await new Promise(resolve=>child.on("exit",(_code,signal)=>resolve(signal)))).toBe("SIGKILL");
  expect((await f.cli(["flush"])).code).toBe(0);const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT count(*) n FROM workflow_runs WHERE id=?").get(id)).toEqual({n:phase==="descriptor-temp"?0:1});}finally{db.close();}
  if(phase!=="descriptor-temp"){expect((await f.cli(["report","--workflow-run",id,"--type","workflow.started","--payload",f.file({})])).code).toBe(0);expect(JSON.parse(readFileSync(join(f.config.outbox,"workflow-runs",id,"state.json"),"utf8"))).toMatchObject({allocatedThrough:1,acknowledgedThrough:1});}
 }finally{await server.stop();}
});
for(const mode of["before","after"] as const)it(`replays original workflow report bytes after actual server SIGKILL ${mode} commit`,async()=>{
 let server=await launch();const f=await workflowCliFixture(server),dir=server.dir,port=server.port;await server.stop();server=await launch({dir,port,entry:"tests/fixtures/crash-server.ts",extraEnv:{AGENTFLOW_TEST_KEY:"",AGENTFLOW_TEST_CRASH:mode}});
 try{
  const queued=await f.cli(["report","--workflow-run",f.workflowRunId,"--type","workflow.started","--payload",f.file({})]);expect(queued.code).toBe(2);await server.stop();expect(server.child.signalCode).toBe("SIGKILL");
  const directory=join(f.config.outbox,"workflow-runs",f.workflowRunId),name=readdirSync(directory).find(n=>n.startsWith("1-"))!,bytes=readFileSync(join(directory,name)),record=JSON.parse(bytes.toString());
  const db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});let committed:unknown;try{expect(db.prepare("SELECT count(*) n FROM workflow_events").get()).toEqual({n:mode==="after"?1:0});if(mode==="after")committed=JSON.parse((db.prepare("SELECT acknowledgement FROM workflow_events").get() as{acknowledgement:string}).acknowledgement);}finally{db.close();}
  expect(readFileSync(join(directory,name))).toEqual(bytes);server=await launch({dir,port});const flushed=await f.cli(["flush","--workflow-run",f.workflowRunId]);expect(flushed.code).toBe(0);const ack=JSON.parse(flushed.stdout);expect(ack.eventId).toBe(record.body.eventId);expect(ack.acceptedSequence).toBe(1);if(committed)expect(ack).toEqual({...((committed as{data:object}).data),generation:(committed as{generation:string}).generation});
  const inspect=new Database(join(dir,"agentflow.sqlite"),{readonly:true});try{expect(inspect.prepare("SELECT count(*) n FROM workflow_events").get()).toEqual({n:1});expect(inspect.prepare("SELECT last_sequence FROM runs WHERE id=?").get(f.runId)).toEqual({last_sequence:0});}finally{inspect.close();}
 }finally{await server.stop();}
},30000);
