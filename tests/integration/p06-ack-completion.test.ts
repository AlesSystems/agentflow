import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch,stop } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { openOutbox } from "../../src/cli/outbox";
it.each(["before","after"])("observes ACK completion with a concurrent enqueue %s ACK ownership",async phase=> {
 const server=await launch(),f=await registeredRun(server);
 const config={port:server.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined};
 const box=await openOutbox(config,performance.now()+15000);
 let child:ReturnType<typeof spawn>|undefined;
 try {
  const first=await box.enqueue(f.runId,"run.started",{});
  const response=await fetch(server.url+`/api/v1/runs/${f.runId}/events`,{method:"POST",headers:{Authorization:"Bearer "+config.token,"Content-Type":"application/json"},body:JSON.stringify(first.body)});
  expect(response.status).toBe(201);const generation=response.headers.get("agentflow-generation")!;
  const path=join(f.dir,"ack-record.json");writeFileSync(path,JSON.stringify(first),{mode:0o600});
  child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-ack-owner.ts",phase,path,generation],{env:{...process.env,...f.env},stdio:["pipe","pipe","pipe"]});
  const exit=new Promise(resolve=>child!.once("exit",resolve));
  let errors="";child.stderr!.on("data",c=>errors+=c);
  const lines=createInterface({input:child.stdout!})[Symbol.asyncIterator]();
  expect((await lines.next()).value).toBe("ready");
  let second;
  if(phase==="before") {second=await box.enqueue(f.runId,"run.heartbeat",{});child.stdin!.write("continue\n");}
  else {
   child.stdin!.write("continue\n");expect((await lines.next()).value).toBe("owner-held");
   let completed=false;const pending=box.enqueue(f.runId,"run.heartbeat",{}).then(value=>{completed=true;return value;});
   await Promise.resolve();expect(completed).toBe(false);child.stdin!.write("continue\n");second=await pending;
  }
  const result=JSON.parse((await lines.next()).value!);
  expect(await exit,errors).toBe(0);
  expect(result).toEqual({result:{complete:phase==="after"}});
  const state=JSON.parse(readFileSync(join(config.outbox,f.runId,"state.json"),"utf8"));
  expect(state).toMatchObject({allocatedThrough:2,acknowledgedThrough:1});
  expect((await box.next(f.runId))?.body).toEqual(second.body);
  expect((await f.cli(["flush"])).code).toBe(0);
  const events=await(await fetch(server.url+`/api/v1/runs/${f.runId}/events`,{headers:{Authorization:"Bearer "+config.token}})).json();
  expect(events.data.items.map((e:{eventId:string;sequence:number})=>[e.eventId,e.sequence])).toEqual([[first.body.eventId,1],[second.body.eventId,2]]);
 }finally{if(child)await stop(child);box.close();await server.stop();}
});
