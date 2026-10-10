import { readFileSync,readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";

it("replays an exact committed event after every acknowledgement is lost",async()=> {
  const server=await launch();let drop=true;let committed:unknown;
  const proxy=await publicProxy(server,(req,_body,reply)=>{if(req.url?.endsWith("/events")&&reply){committed=JSON.parse(reply.body.toString());if(drop)return{drop:true};}});
  try {
    const f=await registeredRun({...server,port:proxy.port});
    expect((await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})])).code).toBe(2);
    const directory=join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId),file=readdirSync(directory).find(name=>/^1-/.test(name))!,original=readFileSync(join(directory,file));
    const before=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});
    let rows:unknown,run:unknown;
    try{rows=before.prepare("SELECT * FROM run_events").all();run=before.prepare("SELECT version,last_sequence,state FROM runs WHERE id=?").get(f.runId);}finally{before.close();}
    drop=false;
    const result=await f.cli(["flush","--run",f.runId]);expect(result.code).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject((committed as {data:object}).data);
    const after=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});
    try{expect(after.prepare("SELECT * FROM run_events").all()).toEqual(rows);expect(after.prepare("SELECT version,last_sequence,state FROM runs WHERE id=?").get(f.runId)).toEqual(run);}finally{after.close();}
    expect(JSON.parse(original.toString()).body.eventId).toBe(JSON.parse(result.stdout).eventId);
    expect(readdirSync(directory)).toEqual(["state.json"]);
  }finally{await proxy.close();await server.stop();}
});

it("blocks a truncated success body while retaining the original event",async()=> {
  const server=await launch();
  const proxy=await publicProxy(server,(req,_body,reply)=>{if(req.url?.endsWith("/events")&&reply)return{status:200,truncate:true,body:'{"data":',headers:{"Content-Length":"1000","AgentFlow-Generation":reply.generation!}};});
  try {
    const f=await registeredRun({...server,port:proxy.port}),started=performance.now();
    const result=await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})]);
    expect(result.code).toBe(3);expect(result.stderr).toContain("invalid_response");expect(performance.now()-started).toBeLessThan(2000);
    expect(readdirSync(join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId)).filter(name=>/^1-/.test(name))).toHaveLength(1);
  }finally{await proxy.close();await server.stop();}
});
