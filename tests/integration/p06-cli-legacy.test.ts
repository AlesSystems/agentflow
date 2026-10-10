import { randomUUID } from "node:crypto";
import { mkdtempSync,realpathSync,readFileSync,readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect,it } from "vitest";
import { openOwnedStore,migrations } from "../../src/db";
import { canonicalDigest } from "../../src/domain/request-digest";
import { launch } from "../fixtures/server";
import { cliFixture } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";
it("adopts actual uppercase legacy sequence-zero identity without registration and replays its lost ACK",async()=> {
  const dir=mkdtempSync(join(realpathSync(tmpdir()),"agentflow-p06-legacy-")),owned=await openOwnedStore(dir,migrations.slice(0,2));
  const projectId=randomUUID(),agentId=randomUUID(),taskId=randomUUID(),runId=randomUUID().toUpperCase();
  const db=new Database(join(dir,"agentflow.sqlite"));db.pragma("foreign_keys=ON");
  db.prepare("INSERT INTO projects VALUES(?,'Synthetic',NULL,NULL,1,0,0)").run(projectId);
  db.prepare("INSERT INTO agents VALUES(?,'Synthetic','legacy','implementation',1,0)").run(agentId);
  db.prepare("INSERT INTO tasks(id,project_id,title,description,acceptance_criteria,status,priority,tags,version,work_revision,created_at,updated_at) VALUES(?,?,'Synthetic','','','backlog','normal','[]',1,1,0,0)").run(taskId,projectId);
  db.prepare("INSERT INTO runs(id,project_id,agent_id,task_id,purpose,work_revision,state,last_sequence,last_received_at,version,created_at) VALUES(?,?,?,?,'implementation',1,'queued',0,0,1,0)").run(runId,projectId,agentId,taskId);db.close();owned.close();
  const server=await launch({dir});let drop=true,posts=0;let receipt:unknown;
  const proxy=await publicProxy(server,(req,_body,reply)=>{if(!reply&&req.url==="/api/v1/runs"&&req.method==="POST")posts++;if(reply&&req.url?.endsWith("/events")){receipt=JSON.parse(reply.body.toString());if(drop)return{drop:true};}});
  try {
    const f=cliFixture({...server,port:proxy.port}),result=await f.cli(["report","--run",runId,"--type","run.started","--payload",f.file({})]);expect(result.code).toBe(2);expect(posts).toBe(0);
    const directory=join(f.env.AGENTFLOW_OUTBOX_DIR,runId.toLowerCase()),name=readdirSync(directory).find(name=>/^1-/.test(name))!,original=readFileSync(join(directory,name)),record=JSON.parse(original.toString());
    expect(record.body.runId).toBe(runId);expect(record.digest).toBe(canonicalDigest(record.body));expect(JSON.parse(readFileSync(join(directory,"state.json"),"utf8")).runId).toBe(runId);
    const originalAck=(receipt as {data:object}).data;drop=false;const flushed=await f.cli(["flush","--run",runId.toLowerCase()]);expect(flushed.code).toBe(0);expect(JSON.parse(flushed.stdout)).toMatchObject(originalAck);
    const inspect=new Database(join(dir,"agentflow.sqlite"),{readonly:true});try{expect(inspect.prepare("SELECT id,last_sequence,version FROM runs WHERE id=?").get(runId)).toEqual({id:runId,last_sequence:1,version:2});expect(inspect.prepare("SELECT count(*) n FROM run_events").get()).toEqual({n:1});}finally{inspect.close();}
    expect((await fetch(server.url+"/api/v1/runs",{method:"POST",headers:{Authorization:`Bearer ${server.credentials().reporterToken}`,"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify({id:runId,projectId,agentId,taskId,purpose:"implementation",expectedTaskVersion:1})})).status).toBe(409);
    expect(JSON.parse(readFileSync(join(directory,"state.json"),"utf8"))).toMatchObject({runId,allocatedThrough:1,acknowledgedThrough:1});
  }finally{await proxy.close();await server.stop();}
});
