import {expect,it} from "vitest";
import {readFileSync,readdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import Database from "better-sqlite3";
import {launch} from "../fixtures/server";
import {registeredRun} from "../fixtures/p06-cli";
import {publicProxy} from "../fixtures/p06-proxy";
it("fresh CLI replays the same lost terminal ACK and preserves one terminal event",async()=>{
  const server=await launch();let drop=false;let historical:unknown;const requests:unknown[]=[];
  const proxy=await publicProxy(server,(request,body,reply)=>{if(request.url?.endsWith("/events")&&reply){requests.push({body:JSON.parse(body.toString()),status:reply.status,ack:JSON.parse(reply.body.toString())});if(drop){historical=JSON.parse(reply.body.toString());return{drop:true};}}});
  try{
    const f=await registeredRun({...server,port:proxy.port});expect((await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})])).code).toBe(0);
    drop=true;const report=await f.cli(["report","--run",f.runId,"--type","run.succeeded","--payload",f.file({summary:"Synthetic lost terminal receipt"})]);expect(report.code).toBe(2);
    const directory=join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId),name=readdirSync(directory).find(name=>/^2-/.test(name))!,bytes=readFileSync(join(directory,name)),record=JSON.parse(bytes.toString());
    drop=false;const flush=await f.cli(["flush","--run",f.runId]);expect(flush.code).toBe(0);expect(JSON.parse(flush.stdout)).toMatchObject((historical as {data:object}).data);expect(JSON.parse(flush.stdout).eventId).toBe(record.body.eventId);
    const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});let rows:unknown,run:unknown;try{rows=db.prepare("SELECT event_id,sequence,digest,body FROM run_events ORDER BY sequence").all();expect(db.prepare("SELECT count(*) n FROM run_events WHERE event_id=?").get(record.body.eventId)).toEqual({n:1});run=db.prepare("SELECT state,version,last_sequence FROM runs WHERE id=?").get(f.runId);expect(run).toEqual({state:"succeeded",version:3,last_sequence:2});}finally{db.close();}
    expect(requests.filter((item)=> (item as {body:{eventId:string}}).body.eventId===record.body.eventId).every(item=>JSON.stringify((item as {body:unknown}).body)===JSON.stringify(record.body))).toBe(true);
    if(process.env.AGENTFLOW_P07_EVIDENCE_DIR)writeFileSync(join(process.env.AGENTFLOW_P07_EVIDENCE_DIR,"terminal-replay.json"),JSON.stringify({dir:server.dir,outbox:f.dir,record,originalBytesBase64:bytes.toString("base64"),historical,report,flush,requests,rows,run},null,2),{mode:0o600});
  }finally{await proxy.close();await server.stop();}
});

it("lost acknowledged prefix blocks only that run while one actual flush advances healthy restored work",async()=>{
  const {execFileSync}=await import("node:child_process");const {randomUUID}=await import("node:crypto");
  let server=await launch();
  try{
    const f=await registeredRun(server),healthy=randomUUID();
    expect((await f.cli(["run","register","--file",f.file({id:healthy,projectId:f.projectId,agentId:f.agentId,purpose:"planning"}),"--idempotency-key",randomUUID()])).code).toBe(0);
    const dir=server.dir,port=server.port,backup=join(f.dir,"prefix.sqlite"),env={...process.env,AGENTFLOW_DATA_DIR:dir,PORT:String(port)};
    await server.stop();execFileSync(process.execPath,["--import","tsx","src/cli/local.ts","backup","--output",backup],{env});server=await launch({dir,port});
    expect((await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})])).code).toBe(0);
    await server.stop();expect((await f.cli(["report","--run",f.runId,"--type","run.heartbeat","--payload",f.file({})])).code).toBe(2);expect((await f.cli(["report","--run",healthy,"--type","run.started","--payload",f.file({})])).code).toBe(2);
    const directory=join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId),name=readdirSync(directory).find(name=>/^2-/.test(name))!,bytes=readFileSync(join(directory,name)),state=readFileSync(join(directory,"state.json"));
    execFileSync(process.execPath,["--import","tsx","src/cli/local.ts","restore","--from",backup],{env});server=await launch({dir,port});
    const flush=await f.cli(["flush"]);expect(flush.code).toBe(3);expect(flush.stderr).toContain('"expectedSequence":1');expect(readFileSync(join(directory,name))).toEqual(bytes);expect(readFileSync(join(directory,"state.json"))).toEqual(state);expect(JSON.parse(readFileSync(join(f.env.AGENTFLOW_OUTBOX_DIR,healthy,"state.json"),"utf8")).acknowledgedThrough).toBe(1);
    const db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT count(*) n FROM run_events WHERE run_id=?").get(f.runId)).toEqual({n:0});expect(db.prepare("SELECT count(*) n FROM run_events WHERE run_id=?").get(healthy)).toEqual({n:1});}finally{db.close();}
    if(process.env.AGENTFLOW_P07_EVIDENCE_DIR)writeFileSync(join(process.env.AGENTFLOW_P07_EVIDENCE_DIR,"lost-prefix-healthy.json"),JSON.stringify({dir,outbox:f.dir,backup,blockedRun:f.runId,healthy,originalBytesBase64:bytes.toString("base64"),originalStateBase64:state.toString("base64"),flush},null,2),{mode:0o600});
  }finally{await server.stop();}
});
