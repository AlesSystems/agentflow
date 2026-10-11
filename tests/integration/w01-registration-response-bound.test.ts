import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { launch } from "../fixtures/server";
import { cliFixture } from "../fixtures/p06-cli";
it("delivers an existing task registration near the public request bound",async()=>{
 const server=await launch(),f=cliFixture(server);try{
  const created=await f.cli(["project","create","--file",f.file({name:"Synthetic task reply bound"}),"--idempotency-key",randomUUID()]);expect(created.code).toBe(0);const projectId=JSON.parse(created.stdout).id;
  const body={projectId,title:"Synthetic large task",description:"界".repeat(20000),acceptanceCriteria:"界".repeat(1500)};
  while(Buffer.byteLength(JSON.stringify(body))<65500)body.acceptanceCriteria+="界";
  while(Buffer.byteLength(JSON.stringify(body))>65500)body.acceptanceCriteria=body.acceptanceCriteria.slice(0,-1);
  expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(65490);
  const result=await f.cli(["task","create","--file",f.file(body),"--idempotency-key",randomUUID()]);expect(result.code,result.stderr).toBe(0);
 }finally{await server.stop();}
});
it("flushes an already blocked original P07 task registration after a real schema/server upgrade",async()=>{
 const {join}=await import("node:path"),{readFileSync,readdirSync}=await import("node:fs"),Database=(await import("better-sqlite3")).default;
 const baseCwd=process.env.AGENTFLOW_W01_BASE_SOURCE;if(!baseCwd)throw new Error("W01 base source must be explicitly prepared");
 let server=await launch({cwd:baseCwd});const f=cliFixture(server);try{
  const project=await f.cli(["project","create","--file",f.file({name:"Synthetic P07 reply upgrade"}),"--idempotency-key",randomUUID()]);expect(project.code).toBe(0);const projectId=JSON.parse(project.stdout).id,body={projectId,title:"Original retained P07 task",description:"界".repeat(20000),acceptanceCriteria:"界".repeat(1500)};
  while(Buffer.byteLength(JSON.stringify(body))<65500)body.acceptanceCriteria+="界";while(Buffer.byteLength(JSON.stringify(body))>65500)body.acceptanceCriteria=body.acceptanceCriteria.slice(0,-1);
  const key=randomUUID();expect((await f.cli(["task","create","--file",f.file(body),"--idempotency-key",key])).code).toBe(3);const path=join(f.env.AGENTFLOW_OUTBOX_DIR,`registration-${key}.json`),bytes=readFileSync(path);expect(JSON.parse(bytes.toString()).body).toEqual(body);
  const dir=server.dir,port=server.port;await server.stop();server=await launch({dir,port});expect(readFileSync(path)).toEqual(bytes);expect((await f.cli(["flush"])).code).toBe(0);expect(readdirSync(f.env.AGENTFLOW_OUTBOX_DIR).filter(n=>n.startsWith("registration-"))).toEqual([]);
  const db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT count(*) n FROM tasks").get()).toEqual({n:1});expect(db.prepare("SELECT count(*) n FROM receipts WHERE path='/api/v1/tasks'").get()).toEqual({n:1});}finally{db.close();}
 }finally{await server.stop();}
});
