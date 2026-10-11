import { expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync,readdirSync,writeFileSync,mkdirSync,lstatSync,unlinkSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { launch } from "../fixtures/server";
import { workflowCliFixture } from "../fixtures/w01-cli";
import { openOutbox } from "../../src/cli/outbox";
import { canonicalDigest } from "../../src/domain/request-digest";
it("allocates concurrent workflow and same-UUID task reports independently and flushes each original sequence",async()=>{
 let server=await launch();const f=await workflowCliFixture(server);try{
  for(const [selector,type]of[["--run","run.started"],["--workflow-run","workflow.started"]])expect((await f.cli(["report",selector,f.runId,"--type",type,"--payload",f.file({})])).code).toBe(0);
  const dir=server.dir,port=server.port;await server.stop();const results=await Promise.all(Array.from({length:3},()=>[["--run","run.heartbeat"],["--workflow-run","workflow.heartbeat"]]).flat().map(([selector,type])=>f.cli(["report",selector,f.runId,"--type",type,"--payload",f.file({})])));expect(results.map(r=>r.code)).toEqual(Array(6).fill(2));
  for(const leaf of[join(f.config.outbox,f.runId),join(f.config.outbox,"workflow-runs",f.runId)]){const records=readdirSync(leaf).filter(n=>/^\d+-/.test(n)).map(n=>JSON.parse(readFileSync(join(leaf,n),"utf8")));expect(records.map(r=>r.body.sequence).sort()).toEqual([2,3,4]);expect(JSON.parse(readFileSync(join(leaf,"state.json"),"utf8"))).toMatchObject({allocatedThrough:4,acknowledgedThrough:1});}
  server=await launch({dir,port});expect((await f.cli(["flush"])).code).toBe(0);const db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});try{for(const table of["run_events","workflow_events"])expect(db.prepare(`SELECT sequence FROM ${table} ORDER BY sequence`).all()).toEqual([1,2,3,4].map(sequence=>({sequence})));}finally{db.close();}
 }finally{await server.stop();}
},30000);
it("rejects at the mixed-kind global byte boundary while an empty same-UUID workflow has independent producer room",async()=>{
 const server=await launch(),f=await workflowCliFixture(server);try{
  const limit=100*1024*1024,producerLimit=10*1024*1024;
  const fill=(id:string,workflow:boolean)=>{const directory=workflow?join(f.config.outbox,"workflow-runs",id):join(f.config.outbox,id);mkdirSync(directory,{recursive:true,mode:0o700});let sequence=0,bytes=0,last="";
   while(bytes<producerLimit-60000){const body={schemaVersion:1,eventId:randomUUID(),...(workflow?{workflowRunId:id}:{runId:id}),sequence:++sequence,occurredAt:"2026-10-11T00:00:00.000Z",type:sequence===1?workflow?"workflow.started":"run.started":workflow?"workflow.node.reported":"run.progress",payload:sequence===1?{}:workflow?{nodeId:f.nodeId,state:"running",reportedSkill:{name:"Synthetic accounting",source:"\0".repeat(2000)}}:{message:"\0".repeat(4000)}};const encoded=JSON.stringify({formatVersion:1,...(workflow?{producerKind:"workflow-run"}:{}),body,digest:canonicalDigest(body)});last=join(directory,`${sequence}-${body.eventId}.json`);writeFileSync(last,encoded,{mode:0o600});bytes+=Buffer.byteLength(encoded);}
   const state=JSON.stringify({formatVersion:1,...(workflow?{producerKind:"workflow-run"}:{}),runId:id,allocatedThrough:sequence,acknowledgedThrough:0,generation:JSON.parse(readFileSync(join(f.config.outbox,"metadata.json"),"utf8")).generation});writeFileSync(join(directory,"state.json"),state,{mode:0o600});bytes+=Buffer.byteLength(state);const old=readFileSync(last);writeFileSync(last,Buffer.concat([old,Buffer.alloc(producerLimit-8192-bytes,32)]),{mode:0o600});};
  fill(f.runId,false);for(let i=0;i<9;i++)fill(randomUUID(),true);
  const size=(path:string):number=>lstatSync(path).isDirectory()?readdirSync(path).reduce((sum,n)=>sum+size(join(path,n)),0):lstatSync(path).size;
  const record={formatVersion:1,path:"/projects",key:randomUUID(),body:{name:"Synthetic global accounting"},order:0,digest:canonicalDigest({name:"Synthetic global accounting"})},encoded=Buffer.from(JSON.stringify(record)),padding=join(f.config.outbox,`registration-${record.key}.json`),gap=limit-size(f.config.outbox)-64;expect(gap).toBeGreaterThan(encoded.length);expect(gap).toBeLessThan(100000);writeFileSync(padding,Buffer.concat([encoded,Buffer.alloc(gap-encoded.length,32)]),{mode:0o600});expect(size(f.config.outbox)).toBe(limit-64);
  const original=readFileSync(join(f.config.outbox,"workflow-runs",f.runId,"state.json")),outbox=await openOutbox(f.config,performance.now()+60000);try{await expect(outbox.enqueue(f.ref,"workflow.started",{})).rejects.toThrow("outbox_full");expect(readFileSync(join(f.config.outbox,"workflow-runs",f.runId,"state.json"))).toEqual(original);unlinkSync(padding);expect((await outbox.enqueue(f.ref,"workflow.started",{})).body.sequence).toBe(1);}finally{outbox.close();}
 }finally{await server.stop();}
},60000);
it("keeps a restored workflow's missing remote prefix while a same-UUID task advances its own generation",async()=>{
 const {openOwnedStore}=await import("../../src/db"),{restore}=await import("../../src/db/recovery");let server=await launch();const f=await workflowCliFixture(server);try{
  expect((await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})])).code).toBe(0);const dir=server.dir,port=server.port;await server.stop();const owned=await openOwnedStore(dir),backup=join(dir,"backups","mixed-prefix.sqlite");await owned.store.backup(backup);owned.close();server=await launch({dir,port});expect((await f.cli(["report","--workflow-run",f.runId,"--type","workflow.started","--payload",f.file({})])).code).toBe(0);await server.stop();
  for(const [selector,type]of[["--workflow-run","workflow.heartbeat"],["--run","run.heartbeat"]])expect((await f.cli(["report",selector,f.runId,"--type",type,"--payload",f.file({})])).code).toBe(2);
  const wf=join(f.config.outbox,"workflow-runs",f.runId),name=readdirSync(wf).find(n=>/^2-/.test(n))!,bytes=readFileSync(join(wf,name)),state=readFileSync(join(wf,"state.json"));await restore(dir,backup);server=await launch({dir,port});const flushed=await f.cli(["flush"]);expect(flushed.code).toBe(3);expect(readFileSync(join(wf,name))).toEqual(bytes);expect(readFileSync(join(wf,"state.json"))).toEqual(state);
  const outbox=await openOutbox(f.config,performance.now()+5000);try{expect(await outbox.initializeRun(f.ref)).toMatchObject({kind:"blocked",code:"remote_prefix_mismatch"});expect((await outbox.initializeRun(f.runId)).kind).toBe("delivered");}finally{outbox.close();}
  const task=JSON.parse(readFileSync(join(f.config.outbox,f.runId,"state.json"),"utf8")),workflow=JSON.parse(readFileSync(join(wf,"state.json"),"utf8"));expect(task).toMatchObject({allocatedThrough:2,acknowledgedThrough:2});expect(workflow).toMatchObject({allocatedThrough:2,acknowledgedThrough:1});expect(task.generation).not.toBe(workflow.generation);
 }finally{await server.stop();}
},30000);
