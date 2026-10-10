import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { readFileSync,readdirSync,writeFileSync,existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";
import { openOutbox } from "../../src/cli/outbox";
const execute=promisify(execFile),a="00000000-0000-4000-8000-000000000001",b="ffffffff-ffff-4fff-bfff-ffffffffffff";
async function register(f:Awaited<ReturnType<typeof registeredRun>>,id:string) {
  const body={id,projectId:f.projectId,agentId:f.agentId,purpose:"planning"};
  expect((await f.cli(["run","register","--file",f.file(body),"--idempotency-key",randomUUID()])).code).toBe(0);return body;
}
function original(root:string,id:string){const directory=join(root,id),name=readdirSync(directory).find(name=>/^1-/.test(name))!;return{path:join(directory,name),bytes:readFileSync(join(directory,name)),state:readFileSync(join(directory,"state.json"))};}
it("continues healthy B after actual restored historical ACK reveals A's advanced remote prefix",async()=> {
  let server=await launch(),drop=true;const attempts:string[]=[];
  const proxy=await publicProxy(server,(req,_body,reply)=>{if(req.url?.endsWith("/events")){if(!reply)attempts.push(req.url);if(reply&&drop&&req.url.includes(a))return{drop:true};}});
  try {
    const f=await registeredRun({...server,port:proxy.port});await register(f,a);await register(f,b);
    const root=f.env.AGENTFLOW_OUTBOX_DIR,config={port:proxy.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined};
    const box=await openOutbox(config,performance.now()+5000);try{await box.enqueue(a,"run.started",{});await box.enqueue(b,"run.started",{});}finally{box.close();}
    expect((await f.cli(["flush","--run",a])).code).toBe(2);const oldA=original(root,a),oldB=original(root,b);
    await server.stop();const backup=join(server.dir,"backups","p06-remote-prefix.sqlite");
    for(const args of [["backup","--output",backup],["restore","--from",backup]])await execute(process.execPath,["--import","tsx","src/cli/local.ts",...args],{env:{...process.env,AGENTFLOW_DATA_DIR:server.dir,PORT:String(server.port)},timeout:15000});
    server=await launch({dir:server.dir,port:server.port});drop=false;
    const external={schemaVersion:1,eventId:randomUUID(),runId:a,sequence:2,type:"run.heartbeat",occurredAt:new Date().toISOString(),payload:{}};
    expect((await fetch(server.url+`/api/v1/runs/${a}/events`,{method:"POST",headers:{Authorization:`Bearer ${config.token}`,"Content-Type":"application/json"},body:JSON.stringify(external)})).status).toBe(201);
    attempts.length=0;const result=await f.cli(["flush"]);expect(result.code).toBe(3);expect(result.stderr).toContain("remote_prefix_mismatch");expect(JSON.parse(readFileSync(join(root,b,"state.json"),"utf8")).acknowledgedThrough).toBe(1);expect(result.stderr).toContain(a);expect(result.stderr).not.toContain(server.dir);
    expect(JSON.parse(result.stdout).eventId).toBe(JSON.parse(oldB.bytes.toString()).body.eventId);expect(attempts).toEqual([`/api/v1/runs/${a}/events`,`/api/v1/runs/${b}/events`]);
    expect(readFileSync(oldA.path)).toEqual(oldA.bytes);expect(readFileSync(join(root,a,"state.json"))).toEqual(oldA.state);expect(JSON.parse(readFileSync(join(root,b,"state.json"),"utf8")).acknowledgedThrough).toBe(1);
    const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT id,last_sequence,version FROM runs WHERE id IN (?,?) ORDER BY id").all(a,b)).toEqual([{id:a,last_sequence:2,version:3},{id:b,last_sequence:1,version:2}]);expect(db.prepare("SELECT event_id,digest FROM run_events WHERE run_id=?").get(b)).toEqual({event_id:JSON.parse(oldB.bytes.toString()).body.eventId,digest:JSON.parse(oldB.bytes.toString()).digest});}finally{db.close();}
  }finally{await proxy.close();await server.stop();}
});
it.each(["run_identity_mismatch","producer_state_required"])("keeps current-GET %s local to its registration while B progresses",async code=> {
  const server=await launch();let wrong=false;
  const proxy=await publicProxy(server,(req,_body,reply)=>{if(wrong&&reply&&req.method==="GET"&&req.url===`/api/v1/runs/${a}`){const body=JSON.parse(reply.body.toString());body.data.id=b;return{status:200,body:JSON.stringify(body),headers:{"AgentFlow-Generation":reply.generation!}};}});
  try {
    const f=await registeredRun({...server,port:proxy.port});await register(f,b);
    const body={id:a,projectId:f.projectId,agentId:f.agentId,purpose:"planning"},token=server.credentials().reporterToken;
    expect((await fetch(server.url+"/api/v1/runs",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify(body)})).status).toBe(201);
    if(code==="producer_state_required")expect((await fetch(server.url+`/api/v1/runs/${a}/events`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({schemaVersion:1,eventId:randomUUID(),runId:a,sequence:1,type:"run.started",occurredAt:new Date().toISOString(),payload:{}})})).status).toBe(201);
    const root=f.env.AGENTFLOW_OUTBOX_DIR,key=randomUUID(),box=await openOutbox({port:proxy.port,token,outbox:root,explicitService:undefined},performance.now()+5000);
    try{await box.enqueue(b,"run.started",{});await box.preserveRegistration("/runs",key,body);}finally{box.close();}
    const journal=join(root,`registration-${key}.json`),bytes=readFileSync(journal),oldB=original(root,b);wrong=code==="run_identity_mismatch";
    const result=await f.cli(["flush"]);expect(result.code).toBe(3);expect(result.stderr).toContain(code);expect(JSON.parse(readFileSync(join(root,b,"state.json"),"utf8")).acknowledgedThrough).toBe(1);expect(result.stderr).toContain(a);expect(JSON.parse(result.stdout).eventId).toBe(JSON.parse(oldB.bytes.toString()).body.eventId);
    expect(readFileSync(journal)).toEqual(bytes);expect(existsSync(join(root,a,"state.json"))).toBe(false);expect(JSON.parse(readFileSync(join(root,b,"state.json"),"utf8")).acknowledgedThrough).toBe(1);
  }finally{await proxy.close();await server.stop();}
});
it("still fails globally closed on missing local coverage instead of converting every storage exit3 to a job outcome",async()=> {
  const server=await launch();let attempts=0;
  const proxy=await publicProxy(server,(req,_body,reply)=>{if(!reply&&req.url?.endsWith("/events"))attempts++;return undefined;});
  try {
    const f=await registeredRun({...server,port:proxy.port});await register(f,a);await register(f,b);
    const root=f.env.AGENTFLOW_OUTBOX_DIR,box=await openOutbox({port:proxy.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined},performance.now()+5000);try{await box.enqueue(b,"run.started",{});}finally{box.close();}
    const statePath=join(root,a,"state.json"),state=JSON.parse(readFileSync(statePath,"utf8"));state.allocatedThrough=1;writeFileSync(statePath,JSON.stringify(state));const oldB=original(root,b);
    const result=await f.cli(["flush"]);expect(result.code).toBe(3);expect(result.stderr).toContain("missing_sequence");expect(attempts).toBe(0);expect(readFileSync(oldB.path)).toEqual(oldB.bytes);expect(readFileSync(join(root,b,"state.json"))).toEqual(oldB.state);
  }finally{await proxy.close();await server.stop();}
});
