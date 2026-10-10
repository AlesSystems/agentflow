import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";
import { openOutbox } from "../../src/cli/outbox";
it("selects FIFO and durably advances its cursor under one publication owner before actual HTTP",async()=> {
 const server=await launch(),attempts:{body:unknown;trace:unknown}[]=[];
 let trace="";
 const proxy=await publicProxy(server,(req,body,reply)=>{if(!reply&&req.url?.endsWith("/events"))attempts.push({body:JSON.parse(body.toString()),trace:JSON.parse(readFileSync(trace,"utf8"))});return undefined;});
 const f=await registeredRun({...server,port:proxy.port});trace=join(f.dir,"selection-trace.json");
 try {
  const box=await openOutbox({port:proxy.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined},performance.now()+5000);
  let first,second;try{first=await box.enqueue(f.runId,"run.started",{});second=await box.enqueue(f.runId,"run.heartbeat",{});}finally{box.close();}
  const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-selection-trace.ts",trace,"flush"],{env:{...process.env,...f.env},stdio:["ignore","pipe","pipe"]});let stderr="";child.stdout.resume();child.stderr.on("data",c=>stderr+=c);
  expect(await new Promise(resolve=>child.once("exit",resolve)),stderr).toBe(0);
  expect(attempts.map(attempt=>attempt.body)).toEqual([first.body,second.body]);
  for(const [index,attempt]of attempts.entries()) {
   const turn=(attempt.trace as {turns:{owners:number[];cursorOwner:number;durable:boolean;record:unknown}[]}).turns[index];
   expect(turn.owners).toHaveLength(1);expect(turn.cursorOwner).toBe(turn.owners[0]);expect(turn.durable).toBe(true);expect(turn.record).toEqual(attempt.body);
  }
 }finally{await proxy.close();await server.stop();}
});
