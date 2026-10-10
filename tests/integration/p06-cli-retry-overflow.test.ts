import { readFileSync,readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";
import { request } from "../../src/cli/http";
import { settingsResponse } from "../../src/contracts/responses";
it.each([307,309])("caps valid %s-digit Retry-After seconds without retry pressure or identity loss",async digits=> {
  const server=await launch();let blocked=true,attempts=0;
  const retry="9".repeat(digits);
  const proxy=await publicProxy(server,(req,_body,reply)=>{if(!reply&&req.url?.endsWith("/events")){attempts++;if(blocked)return{status:503,body:"",headers:{"Retry-After":retry}};}});
  try {
    const f=await registeredRun({...server,port:proxy.port}),start=performance.now();
    const result=await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})]);expect(result.code).toBe(2);expect(performance.now()-start).toBeLessThan(5700);expect(attempts).toBe(1);
    const directory=join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId),name=readdirSync(directory).find(name=>/^1-/.test(name))!,bytes=readFileSync(join(directory,name)),original=JSON.parse(bytes.toString());
    expect(JSON.parse(readFileSync(join(directory,"state.json"),"utf8"))).toMatchObject({allocatedThrough:1,acknowledgedThrough:0});
    blocked=false;const flushed=await f.cli(["flush","--run",f.runId]);expect(flushed.code).toBe(0);expect(JSON.parse(flushed.stdout).eventId).toBe(original.body.eventId);expect(attempts).toBe(2);
    const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT event_id,sequence,digest,occurred_at FROM run_events").all()).toEqual([{event_id:original.body.eventId,sequence:1,digest:original.digest,occurred_at:Date.parse(original.body.occurredAt)}]);expect(db.prepare("SELECT version,last_sequence FROM runs WHERE id=?").get(f.runId)).toEqual({version:2,last_sequence:1});}finally{db.close();}
  }finally{await proxy.close();await server.stop();}
});
it("keeps normal seconds, dates and malformed Retry-After behavior at the transport boundary",async()=> {
  const server=await launch();let retry="30";
  const proxy=await publicProxy(server,(req,_body,reply)=>{if(!reply&&req.url==="/api/v1/settings")return{status:503,body:"",headers:{"Retry-After":retry}};});
  const config={port:proxy.port,token:server.credentials().reporterToken,outbox:"unused",explicitService:undefined};
  try {
    expect(await request(config,"/settings",settingsResponse,performance.now()+500)).toEqual({kind:"retryable",delay:30000});
    retry="0";expect(await request(config,"/settings",settingsResponse,performance.now()+500)).toEqual({kind:"retryable",delay:0});
    retry="malformed-header";expect(await request(config,"/settings",settingsResponse,performance.now()+500)).toEqual({kind:"retryable",delay:100});
    retry=new Date(Date.now()+3000).toUTCString();const future=await request(config,"/settings",settingsResponse,performance.now()+500);expect(future.kind).toBe("retryable");if(future.kind==="retryable"){expect(future.delay).toBeGreaterThan(1500);expect(future.delay).toBeLessThanOrEqual(3000);}
    retry="Thu, 01 Jan 1970 00:00:00 GMT";expect(await request(config,"/settings",settingsResponse,performance.now()+500)).toEqual({kind:"retryable",delay:0});
  }finally{await proxy.close();await server.stop();}
});
