import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { launch } from "../fixtures/server";
import { cliFixture } from "../fixtures/p06-cli";
it("durably orders never-delivered workflow revisions attempts and reports while isolating same UUID task producers", async () => {
 let server = await launch(); const f = cliFixture(server);
 const create = async (args: string[], body: unknown) => { const result = await f.cli([...args, "--file", f.file(body), "--idempotency-key", randomUUID()]); expect(result.code).toBe(0); return JSON.parse(result.stdout).id as string; };
 try {
  const projectId = await create(["project","create"], { name: "Synthetic offline chain" });
  const agentId = await create(["agent","register"], { displayName: "Synthetic", source: "W01", defaultRole: "implementation" });
  const sameId = randomUUID(); await create(["run","register"], { id: sameId, projectId, agentId, purpose: "planning" });
  const workflowId = randomUUID(), revisionId = randomUUID(), nodeId = randomUUID();
  const dir = server.dir, port = server.port; await server.stop();
  const offline = {};
  for (const [args, body] of [
   [["register","workflow"], { id: workflowId, projectId, name: "Never delivered" }],
   [["register","workflow-revision","--workflow",workflowId], { id: revisionId, expectedWorkflowVersion: 1, nodes: [{ id: nodeId, label: "Node" }], edges: [] }],
   [["register","workflow-run"], { id: sameId, workflowId, planRevisionId: revisionId }],
  ] as [string[],unknown][]) expect((await f.cli([...args,"--file",f.file(body),"--idempotency-key",randomUUID()],offline)).code).toBe(2);
  const started = await f.cli(["report","--workflow-run",sameId,"--type","workflow.started","--payload",f.file({})],offline); expect(started.code).toBe(2);
  expect((await f.cli(["report","--run",sameId,"--type","run.started","--payload",f.file({})],offline)).code).toBe(2);
  const workflowDir = join(f.env.AGENTFLOW_OUTBOX_DIR,"workflow-runs",sameId);
  const envelopeName = readdirSync(workflowDir).find(n => /^1-/.test(n))!; const original = readFileSync(join(workflowDir,envelopeName));
  expect(JSON.parse(original.toString()).producerKind).toBe("workflow-run");
  expect(JSON.parse(readFileSync(join(f.env.AGENTFLOW_OUTBOX_DIR,sameId,"state.json"),"utf8")).allocatedThrough).toBe(1);
  expect(JSON.parse(readFileSync(join(workflowDir,"state.json"),"utf8")).allocatedThrough).toBe(1);
  server = await launch({ dir, port });
  const flush = await f.cli(["flush"]); expect(flush.code).toBe(0);
  const db = new Database(join(dir,"agentflow.sqlite"), { readonly: true });
  try { expect(db.prepare("SELECT last_sequence FROM workflow_runs WHERE id=?").get(sameId)).toEqual({last_sequence:1}); expect(db.prepare("SELECT last_sequence FROM runs WHERE id=?").get(sameId)).toEqual({last_sequence:1}); expect(JSON.parse((db.prepare("SELECT body FROM workflow_events WHERE workflow_run_id=?").get(sameId) as {body:string}).body)).toMatchObject(JSON.parse(original.toString()).body); } finally { db.close(); }
  expect(readdirSync(workflowDir).filter(n=>/^1-/.test(n))).toEqual([]);
  expect((await f.cli(["report","--run",sameId,"--workflow-run",sameId,"--type","workflow.heartbeat","--payload",f.file({})])).code).toBe(1);
 } finally { await server.stop(); }
}, 60000);
it("retains a rejected workflow prerequisite and dependent prefix byte-for-byte while unrelated task reports drain",async()=>{
 let server=await launch();const f=cliFixture(server);
 const register=async(args:string[],body:unknown)=>{const r=await f.cli([...args,"--file",f.file(body),"--idempotency-key",randomUUID()]);expect(r.code).toBe(0);return JSON.parse(r.stdout).id as string;};
 try{
  const projectId=await register(["project","create"],{name:"Synthetic independent drain"}),agentId=await register(["agent","register"],{displayName:"Synthetic",source:"W01",defaultRole:"implementation"});
  const taskRunId=await register(["run","register"],{id:randomUUID(),projectId,agentId,purpose:"planning"});
  const workflowId=randomUUID(),revisionId=randomUUID(),workflowRunId=randomUUID(),revisionKey=randomUUID(),runKey=randomUUID();const dir=server.dir,port=server.port;await server.stop();
  expect((await f.cli(["register","workflow","--file",f.file({id:workflowId,projectId,name:"Blocked revision"}),"--idempotency-key",randomUUID()])).code).toBe(2);
  expect((await f.cli(["register","workflow-revision","--workflow",workflowId,"--file",f.file({id:revisionId,expectedWorkflowVersion:2,nodes:[{id:randomUUID(),label:"Node"}],edges:[]}),"--idempotency-key",revisionKey])).code).toBe(2);
  expect((await f.cli(["register","workflow-run","--file",f.file({id:workflowRunId,workflowId,planRevisionId:revisionId}),"--idempotency-key",runKey])).code).toBe(2);
  expect((await f.cli(["report","--workflow-run",workflowRunId,"--type","workflow.started","--payload",f.file({})])).code).toBe(2);
  expect((await f.cli(["report","--run",taskRunId,"--type","run.started","--payload",f.file({})])).code).toBe(2);
  const wfDir=join(f.env.AGENTFLOW_OUTBOX_DIR,"workflow-runs",workflowRunId);
  const paths=[join(f.env.AGENTFLOW_OUTBOX_DIR,`registration-${revisionKey}.json`),join(f.env.AGENTFLOW_OUTBOX_DIR,`registration-${runKey}.json`),join(wfDir,readdirSync(wfDir).find(n=>/^1-/.test(n))!)];const bytes=paths.map(path=>readFileSync(path));
  server=await launch({dir,port});const flushed=await f.cli(["flush"]);expect(flushed.code).toBe(3);expect(flushed.stderr).toContain("version_conflict");paths.forEach((path,i)=>expect(readFileSync(path)).toEqual(bytes[i]));
  const db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT last_sequence FROM runs WHERE id=?").get(taskRunId)).toEqual({last_sequence:1});expect(db.prepare("SELECT count(*) n FROM workflow_runs").get()).toEqual({n:0});}finally{db.close();}
 }finally{await server.stop();}
},60000);
it("publishes a valid plan near the request limit with a bounded registration acknowledgement",async()=>{
 const server=await launch(),f=cliFixture(server);
 try{
  const p=await f.cli(["project","create","--file",f.file({name:"Synthetic request bound"}),"--idempotency-key",randomUUID()]);expect(p.code).toBe(0);const projectId=JSON.parse(p.stdout).id;
  const workflowId=randomUUID();expect((await f.cli(["register","workflow","--file",f.file({id:workflowId,projectId,name:"Bounded acknowledgement"}),"--idempotency-key",randomUUID()])).code).toBe(0);
  const body={id:randomUUID(),expectedWorkflowVersion:1,nodes:Array.from({length:100},()=>({id:randomUUID(),label:"界".repeat(150)})),edges:[]};let index=0;
  while(Buffer.byteLength(JSON.stringify(body))<65500){const node=body.nodes[index++%100];if(node.label.length<200)node.label+="界";else break;}
  while(Buffer.byteLength(JSON.stringify(body))>65500){const node=body.nodes[(--index+100)%100];node.label=node.label.slice(0,-1);}
  expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(65490);
  const result=await f.cli(["register","workflow-revision","--workflow",workflowId,"--file",f.file(body),"--idempotency-key",randomUUID()]);expect(result.code).toBe(0);
  const read=await fetch(server.url+`/api/v1/workflows/${workflowId}/revisions/${body.id}`,{headers:{Authorization:"Bearer "+server.credentials().reporterToken}});expect(read.status).toBe(200);expect((await read.json()).data.nodes).toEqual(body.nodes);
 }finally{await server.stop();}
});
