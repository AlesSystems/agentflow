import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync,readdirSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { openOutbox } from "../../src/cli/outbox";
import { publicProxy } from "../fixtures/p06-proxy";
it.each(["wait","accounting","io"])("preserves clean cursor admission %s phase without HTTP or cursor mutation then delivers fresh",async phase=> {
 const server=await launch(),attempts:string[]=[];
 const proxy=await publicProxy(server,(req,_body,reply)=>{if(!reply&&req.url?.endsWith("/events"))attempts.push(req.url);return undefined;});
 const f=await registeredRun({...server,port:proxy.port});
 try {
  const box=await openOutbox({port:proxy.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined},performance.now()+5000);
  try{await box.enqueue(f.runId,"run.started",{});await box.enqueue(f.runId,"run.heartbeat",{});}finally{box.close();}
  const metadata=join(f.env.AGENTFLOW_OUTBOX_DIR,"metadata.json"),original=readFileSync(metadata),dir=join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId);
  const retained=Object.fromEntries(readdirSync(dir).map(name=>[name,readFileSync(join(dir,name))]));
  const trace=join(f.dir,"admission-trace.json");
  const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-admission-cli.ts",phase,trace,"flush"],{env:{...process.env,...f.env},stdio:["ignore","pipe","pipe"]});
  let stderr="";child.stderr.on("data",c=>stderr+=c);child.stdout.resume();
  expect(await new Promise(resolve=>child.once("exit",resolve)),stderr).toBe(phase==="io"?1:2);
  expect(stderr).not.toContain("fixture native SQLite");expect(stderr).not.toContain(server.credentials().reporterToken);
  expect(attempts).toEqual([]);expect(readFileSync(metadata)).toEqual(original);
  for(const[name,bytes]of Object.entries(retained))expect(readFileSync(join(dir,name))).toEqual(bytes);
  expect(JSON.parse(readFileSync(trace,"utf8")).stack).toContain("selectForTurn");
  expect((await f.cli(["flush"])).code).toBe(0);expect(attempts).toHaveLength(2);
 } finally {await proxy.close();await server.stop();}
});

it("keeps blocked 3 above a later queued native cursor timeout and resumes the durable ring",async()=> {
 const server=await launch(),attempts:string[]=[];let reject=true;
 const ids=["00000000-0000-4000-8000-000000000001","ffffffff-ffff-4fff-bfff-ffffffffffff"];
 const proxy=await publicProxy(server,(req,_body,reply)=>{if(!reply&&req.url?.endsWith("/events")){attempts.push(req.url);if(reject&&req.url.includes(ids[0]))return{status:409,body:JSON.stringify({error:{code:"run_terminal",message:"synthetic blocked"}})};}return undefined;});
 const f=await registeredRun({...server,port:proxy.port});
 try {
  const box=await openOutbox({port:proxy.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined},performance.now()+10000);
  try {for(const id of ids){expect((await f.cli(["run","register","--file",f.file({id,projectId:f.projectId,agentId:f.agentId,purpose:"planning"}),"--idempotency-key",randomUUID()])).code).toBe(0);await box.enqueue(id,"run.started",{});}}finally{box.close();}
  const trace=join(f.dir,"precedence-trace.json");const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-admission-cli.ts","second-wait",trace,"flush"],{env:{...process.env,...f.env},stdio:["ignore","pipe","pipe"]});let stderr="";child.stdout.resume();child.stderr.on("data",c=>stderr+=c);
  expect(await new Promise(resolve=>child.once("exit",resolve)),stderr).toBe(3);
  expect(attempts).toEqual([`/api/v1/runs/${ids[0]}/events`]);
  expect(JSON.parse(readFileSync(join(f.env.AGENTFLOW_OUTBOX_DIR,"metadata.json"),"utf8")).cursor).toBe(`run:${ids[1]}`);
  reject=false;expect((await f.cli(["flush"])).code).toBe(0);
  expect(attempts.slice(1)).toEqual([`/api/v1/runs/${ids[1]}/events`,`/api/v1/runs/${ids[0]}/events`]);
 }finally{await proxy.close();await server.stop();}
});

it("keeps actual combined-owner rollback IO failure local1 before HTTP with durable cursor and exact retained records",async()=> {
 const server=await launch(),attempts:string[]=[];
 const proxy=await publicProxy(server,(req,_body,reply)=>{if(!reply&&req.url?.endsWith("/events"))attempts.push(req.url);return undefined;});
 const f=await registeredRun({...server,port:proxy.port});
 try {
  const config={port:proxy.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined},box=await openOutbox(config,performance.now()+5000);let event;
  try{event=await box.enqueue(f.runId,"run.started",{});}finally{box.close();}
  const recordPath=join(config.outbox,f.runId,`1-${event.body.eventId}.json`),original=readFileSync(recordPath),trace=join(f.dir,"rollback-trace.json");
  const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-admission-cli.ts","rollback",trace,"flush"],{env:{...process.env,...f.env},stdio:["ignore","pipe","pipe"]});let stderr="";child.stdout.resume();child.stderr.on("data",c=>stderr+=c);
  expect(await new Promise(resolve=>child.once("exit",resolve)),stderr).toBe(1);expect(attempts).toEqual([]);expect(readFileSync(recordPath)).toEqual(original);
  expect(JSON.parse(readFileSync(join(config.outbox,"metadata.json"),"utf8")).cursor).toBe(`run:${f.runId}`);
  expect(stderr).not.toContain("fixture native SQLite");expect((await f.cli(["flush"])).code).toBe(0);expect(attempts).toEqual([`/api/v1/runs/${f.runId}/events`]);
 }finally{await proxy.close();await server.stop();}
});
