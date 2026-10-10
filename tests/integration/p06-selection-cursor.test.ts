import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";
import { openOutbox } from "../../src/cli/outbox";
it("selects FIFO and durably advances its cursor under one publication owner before actual HTTP",async()=> {
 const server=await launch(),attempts:{body:unknown;trace:unknown;publicationFree:boolean}[]=[];
 let trace="",outboxDir="";
 const proxy=await publicProxy(server,(req,body,reply)=>{if(!reply&&req.url?.endsWith("/events")){
 const lock=new Database(join(outboxDir,"publication.sqlite"),{timeout:0});let publicationFree=false;
 try{lock.exec("BEGIN EXCLUSIVE");lock.exec("ROLLBACK");publicationFree=true;}finally{lock.close();}
 attempts.push({body:JSON.parse(body.toString()),trace:JSON.parse(readFileSync(trace,"utf8")),publicationFree});
 }return undefined;});
 const f=await registeredRun({...server,port:proxy.port});trace=join(f.dir,"selection-trace.json");outboxDir=f.env.AGENTFLOW_OUTBOX_DIR;
 try {
  const box=await openOutbox({port:proxy.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined},performance.now()+5000);
  let first,second;try{first=await box.enqueue(f.runId,"run.started",{});second=await box.enqueue(f.runId,"run.heartbeat",{});}finally{box.close();}
  const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-selection-trace.ts",trace,"flush"],{env:{...process.env,...f.env},stdio:["ignore","pipe","pipe"]});let stderr="";child.stdout.resume();child.stderr.on("data",c=>stderr+=c);
  expect(await new Promise(resolve=>child.once("exit",resolve)),stderr).toBe(0);
  expect(attempts.map(attempt=>attempt.body)).toEqual([first.body,second.body]);
  for(const [index,attempt]of attempts.entries()) {
   const turn=(attempt.trace as {turns:{owners:number[];cursorOwner:number;durable:boolean;record:unknown}[]}).turns[index];
   expect(attempt.publicationFree).toBe(true);expect(turn.owners).toHaveLength(1);expect(turn.cursorOwner).toBe(turn.owners[0]);expect(turn.durable).toBe(true);expect(turn.record).toEqual(attempt.body);
  }
 }finally{await proxy.close();await server.stop();}
});

it.each(["before","after"])("keeps immutable FIFO with enqueue %s the combined owner",async phase=> {
 const {createInterface}=await import("node:readline");
 const {stop}=await import("../fixtures/server");
 const server=await launch(),f=await registeredRun(server),config={port:server.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined};
 const box=await openOutbox(config,performance.now()+15000);let child:ReturnType<typeof spawn>|undefined;
 try {
  const first=await box.enqueue(f.runId,"run.started",{});
  child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-select-owner.ts",phase,f.runId],{env:{...process.env,...f.env},stdio:["pipe","pipe","pipe"]});const exit=new Promise(resolve=>child!.once("exit",resolve));let errors="";child.stderr!.on("data",c=>errors+=c);
  const lines=createInterface({input:child.stdout!})[Symbol.asyncIterator]();expect((await lines.next()).value).toBe("ready");let second,ownerState;
  if(phase==="before"){second=await box.enqueue(f.runId,"run.heartbeat",{});child.stdin!.write("continue\n");ownerState=JSON.parse((await lines.next()).value!).ownerState;}
  else{child.stdin!.write("continue\n");ownerState=JSON.parse((await lines.next()).value!).ownerState;let completed=false;const pending=box.enqueue(f.runId,"run.heartbeat",{}).then(value=>{completed=true;return value;});await Promise.resolve();expect(completed).toBe(false);child.stdin!.write("continue\n");second=await pending;}
  const selected=JSON.parse((await lines.next()).value!).record;expect(await exit,errors).toBe(0);
  expect(ownerState).toMatchObject({allocatedThrough:phase==="before"?2:1,acknowledgedThrough:0});expect(selected).toEqual(first);
  expect((await f.cli(["flush"])).code).toBe(0);
  const events=await(await fetch(server.url+`/api/v1/runs/${f.runId}/events`,{headers:{Authorization:"Bearer "+config.token}})).json();expect(events.data.items.map((e:{eventId:string})=>e.eventId)).toEqual([first.body.eventId,second.body.eventId]);
 }finally{if(child)await stop(child);box.close();await server.stop();}
});

it("plain and empty combined selection perform no cursor IO and targeted flush leaves cursor bytes unchanged",async()=> {
 const server=await launch(),f=await registeredRun(server),writes:string[]=[];
 const {createFile,syncDirectory}=await import("../../src/server/filesystem");const {renameSync}=await import("node:fs");
 const metadata=join(f.env.AGENTFLOW_OUTBOX_DIR,"metadata.json"),original=readFileSync(metadata);
 const box=await openOutbox({port:server.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined},performance.now()+10000,{createFile(path,value){if(path.endsWith("metadata.json.tmp"))writes.push("create");createFile(path,value);},renameSync(from,to){if(String(to)===metadata)writes.push("rename");renameSync(from,to);},syncDirectory(path){if(path===f.env.AGENTFLOW_OUTBOX_DIR)writes.push("sync");syncDirectory(path);}});
 try {
  writes.length=0;expect(await box.next(f.runId)).toBeUndefined();expect(await box.selectForTurn(f.runId,`run:${f.runId}`)).toBeUndefined();expect(writes).toEqual([]);expect(readFileSync(metadata)).toEqual(original);
  const event=await box.enqueue(f.runId,"run.started",{});writes.length=0;expect(await box.next(f.runId)).toEqual(event);expect(writes).toEqual([]);
  expect((await f.cli(["flush","--run",f.runId])).code).toBe(0);expect(readFileSync(metadata)).toEqual(original);
  writes.length=0;expect(await box.selectForTurn(f.runId,`run:${f.runId}`)).toBeUndefined();expect(writes).toEqual([]);
 }finally{box.close();await server.stop();}
});
