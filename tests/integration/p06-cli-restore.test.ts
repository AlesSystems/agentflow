import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { readFileSync,readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";
const execute=promisify(execFile);
async function local(server:Awaited<ReturnType<typeof launch>>,args:string[]) {
  const result=await execute(process.execPath,["--import","tsx","src/cli/local.ts",...args],{env:{...process.env,AGENTFLOW_DATA_DIR:server.dir,PORT:String(server.port)},timeout:15000});expect(result.stderr).toBe("");return result;
}
it("replays a retained historical acknowledgement after actual stopped backup restore using the current header",async()=> {
  let server=await launch();let drop=true;let historical:unknown;let generation="";
  const proxy=await publicProxy(server,(req,_body,reply)=>{if(reply&&req.url?.endsWith("/events")){historical=JSON.parse(reply.body.toString());generation=reply.generation!;if(drop)return{drop:true};}});
  try {
    const f=await registeredRun({...server,port:proxy.port});expect((await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})])).code).toBe(2);
    const directory=join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId),name=readdirSync(directory).find(name=>/^1-/.test(name))!,original=readFileSync(join(directory,name)),oldGeneration=generation,originalAck=(historical as {data:object}).data;
    await server.stop();const backup=join(server.dir,"backups","p06-after-event.sqlite");await local(server,["backup","--output",backup]);await local(server,["restore","--from",backup]);server=await launch({dir:server.dir,port:server.port});drop=false;
    const result=await f.cli(["flush","--run",f.runId]);expect(result.code).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject(originalAck);expect(JSON.parse(result.stdout).generation).not.toBe(oldGeneration);
    expect(JSON.parse(result.stdout).eventId).toBe(JSON.parse(original.toString()).body.eventId);
    const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT count(*) n FROM run_events").get()).toEqual({n:1});expect(db.prepare("SELECT version,last_sequence FROM runs WHERE id=?").get(f.runId)).toEqual({version:2,last_sequence:1});}finally{db.close();}
  }finally{await proxy.close();await server.stop();}
});
it("blocks acknowledged-prefix loss after actual stopped restore without recreating or renumbering reports",async()=> {
  let server=await launch();const f=await registeredRun(server),backup=join(server.dir,"backups","p06-sequence-zero.sqlite");
  try {
    await server.stop();await local(server,["backup","--output",backup]);server=await launch({dir:server.dir,port:server.port});
    expect((await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})])).code).toBe(0);
    await server.stop();expect((await f.cli(["report","--run",f.runId,"--type","run.heartbeat","--payload",f.file({})])).code).toBe(2);
    const directory=join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId),name=readdirSync(directory).find(name=>/^2-/.test(name))!,original=readFileSync(join(directory,name)),state=readFileSync(join(directory,"state.json"));
    await local(server,["restore","--from",backup]);server=await launch({dir:server.dir,port:server.port});
    const result=await f.cli(["flush","--run",f.runId]);expect(result.code).toBe(3);expect(result.stderr).toContain('"expectedSequence":1');expect(readFileSync(join(directory,name))).toEqual(original);expect(readFileSync(join(directory,"state.json"))).toEqual(state);
    const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT count(*) n FROM run_events").get()).toEqual({n:0});}finally{db.close();}
  }finally{await server.stop();}
});
it("retains discarded run/project references after actual stopped restore without automatic remapping",async()=> {
  let server=await launch();const backup=join(server.dir,"backups","p06-empty.sqlite");
  await server.stop();await local(server,["backup","--output",backup]);server=await launch({dir:server.dir,port:server.port});
  try {
    const f=await registeredRun(server);
    const task=await f.cli(["task","create","--file",f.file({projectId:f.projectId,title:"Discarded task"}),"--idempotency-key",randomUUID()]);expect(task.code).toBe(0);const taskId=JSON.parse(task.stdout).id;
    const registration=await f.cli(["run","register","--file",f.file({id:randomUUID(),projectId:f.projectId,agentId:f.agentId,taskId,purpose:"implementation",expectedTaskVersion:1}),"--idempotency-key",randomUUID()]);expect(registration.code).toBe(0);const taskRun=JSON.parse(registration.stdout).id;
    await server.stop();
    expect((await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})])).code).toBe(2);
    expect((await f.cli(["report","--run",taskRun,"--type","run.started","--payload",f.file({})])).code).toBe(2);
    const key=randomUUID();expect((await f.cli(["task","create","--file",f.file({projectId:f.projectId,title:"Discarded synthetic"}),"--idempotency-key",key])).code).toBe(2);
    const root=f.env.AGENTFLOW_OUTBOX_DIR,journal=join(root,`registration-${key}.json`),journalBytes=readFileSync(journal),directory=join(root,f.runId),name=readdirSync(directory).find(name=>/^1-/.test(name))!,original=readFileSync(join(directory,name));
    await local(server,["restore","--from",backup]);server=await launch({dir:server.dir,port:server.port});
    const result=await f.cli(["flush"]);expect(result.code).toBe(3);expect(result.stdout).toBe("");expect(result.stderr).toContain("resource_not_found");expect(readFileSync(journal)).toEqual(journalBytes);expect(readFileSync(join(directory,name))).toEqual(original);
    const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{for(const table of ["projects","tasks","runs","run_events"])expect(db.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:0});}finally{db.close();}
  }finally{await server.stop();}
});
