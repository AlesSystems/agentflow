import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";
import { openOutbox } from "../../src/cli/outbox";
async function fixture() {
  const server=await launch(),attempts:string[]=[];
  const proxy=await publicProxy(server,(req,_body,reply)=>{if(!reply&&req.url?.endsWith("/events"))attempts.push(req.url);return undefined;});
  const f=await registeredRun({...server,port:proxy.port}),ids=["00000000-0000-4000-8000-000000000001","ffffffff-ffff-4fff-bfff-ffffffffffff"];
  const config={port:proxy.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined};
  const box=await openOutbox(config,performance.now()+5000);
  try{for(const id of ids){const response=await fetch(server.url+"/api/v1/runs",{method:"POST",headers:{Authorization:`Bearer ${config.token}`,"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify({id,projectId:f.projectId,agentId:f.agentId,purpose:"planning"})});expect(response.status).toBe(201);expect((await box.initializeRun(id)).kind).toBe("delivered");await box.enqueue(id,"run.started",{});}}finally{box.close();}
  return{server,proxy,f,ids,config,attempts};
}
async function child(f:Awaited<ReturnType<typeof registeredRun>>,phase:string) {
  const process=spawn(globalThis.process.execPath,["--import","tsx","tests/fixtures/p06-cursor-cli.ts",phase,"flush"],{env:{...globalThis.process.env,...f.env},stdio:["ignore","pipe","pipe"]});
  let stdout="",stderr="";process.stdout.on("data",chunk=>stdout+=chunk);process.stderr.on("data",chunk=>stderr+=chunk);
  return new Promise<{code:number|null;signal:string|null;stdout:string;stderr:string}>(resolve=>process.on("exit",(code,signal)=>resolve({code,signal,stdout,stderr})));
}
it.each(["create","sync"])("cursor %s failure returns1 before HTTP and preserves every event",async phase=> {
  const x=await fixture();
  try{const original=x.ids.map(id=>readFileSync(join(x.config.outbox,id,"state.json")));expect((await child(x.f,phase)).code).toBe(1);expect(x.attempts).toEqual([]);for(const [i,id]of x.ids.entries())expect(readFileSync(join(x.config.outbox,id,"state.json"))).toEqual(original[i]);expect((await x.f.cli(["flush"])).code).toBe(0);expect(x.attempts).toHaveLength(2);}finally{await x.proxy.close();await x.server.stop();}
});
it("durable cursor SIGKILL defers its job one rotation without losing it",async()=> {
  const x=await fixture();
  try{expect((await child(x.f,"kill")).signal).toBe("SIGKILL");expect(x.attempts).toEqual([]);expect(JSON.parse(readFileSync(join(x.config.outbox,"metadata.json"),"utf8")).cursor).toBe(`run:${x.ids[1]}`);expect((await x.f.cli(["flush"])).code).toBe(0);expect(x.attempts).toEqual([`/api/v1/runs/${x.ids[1]}/events`,`/api/v1/runs/${x.ids[0]}/events`]);}finally{await x.proxy.close();await x.server.stop();}
});
it("targeted flush leaves global cursor unchanged and missing/new ring identities resume at the successor",async()=> {
  const x=await fixture();
  try {
    const metadata=join(x.config.outbox,"metadata.json"),value=JSON.parse(readFileSync(metadata,"utf8"));value.cursor="run:eeeeeeee-eeee-4eee-beee-eeeeeeeeeeee";writeFileSync(metadata,JSON.stringify(value));
    expect((await x.f.cli(["flush","--run",x.ids[0]])).code).toBe(0);expect(JSON.parse(readFileSync(metadata,"utf8")).cursor).toBe(value.cursor);
    const added="11111111-1111-4111-8111-111111111111";
    expect((await x.f.cli(["run","register","--file",x.f.file({id:added,projectId:x.f.projectId,agentId:x.f.agentId,purpose:"planning"}),"--idempotency-key",randomUUID()])).code).toBe(0);
    const box=await openOutbox(x.config,performance.now()+5000);try{await box.enqueue(added,"run.started",{});}finally{box.close();}
    expect(JSON.parse(readFileSync(metadata,"utf8")).cursor).toBe(value.cursor);
    expect((await x.f.cli(["flush"])).code).toBe(0);expect(x.attempts).toEqual([`/api/v1/runs/${x.ids[0]}/events`,`/api/v1/runs/${x.ids[1]}/events`,`/api/v1/runs/${added}/events`]);
  }finally{await x.proxy.close();await x.server.stop();}
});
