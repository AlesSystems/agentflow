import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launch, pair } from "../fixtures/server";
import { workflowCliFixture } from "../fixtures/w01-cli";
import { canonicalDigest } from "../../src/domain/request-digest";
import { publicProxy, type Reply } from "../fixtures/p06-proxy";

for (const kind of ["task", "workflow"] as const) for (const delivery of ["unsent", "lost-ack"] as const) it(`${kind} CLI restart flush after prune preserves ${delivery} identity and advances one watermark`, async () => {
 const server=await launch();let blocked=true;let original:Reply|undefined;let replay:Reply|undefined;const wires:unknown[]=[];const evidence:Record<string,unknown>={kind,delivery,wires};
 const proxy=await publicProxy(server,(req,_body,reply)=>{
  if(!req.url?.endsWith("/events"))return;
  if(blocked&&delivery==="unsent"&&!reply)return {drop:true};
  if(reply){wires.push({status:reply.status,body:reply.body.toString(),generation:reply.generation});if(blocked){original=reply;return {drop:true};}replay=reply;}
 });
 try {
  const f=await workflowCliFixture({...server,port:proxy.port});
  const flag=kind==="task"?"--run":"--workflow-run",type=kind==="task"?"run.started":"workflow.started";
  const directory=kind==="task"?join(f.config.outbox,f.runId):join(f.config.outbox,"workflow-runs",f.workflowRunId);
  expect((await f.cli(["report",flag,f.runId,"--type",type,"--payload",f.file({})])).code).toBe(2);
  const name=readdirSync(directory).find(n=>/^1-/.test(n))!,bytes=readFileSync(join(directory,name));
  const before=JSON.parse(readFileSync(join(directory,"state.json"),"utf8"));evidence.before={name,bytes:bytes.toString(),state:before};expect(before).toMatchObject({allocatedThrough:1,acknowledgedThrough:0});
  const cookie=await pair(server);
  const command=async(path:string,input:unknown)=>fetch(server.url+"/api/v1/retention/"+path,{method:"POST",headers:{Cookie:cookie,Origin:server.url,"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify(input)});
  const preview=await command("preview",{cutoff:new Date(Date.now()-1000).toISOString()});expect(preview.status).toBe(200);const p=(await preview.json()).data;
  const pruned=await command("prune",{previewId:p.previewId,expectedGeneration:p.expectedGeneration,expectedVersion:p.expectedVersion,candidateDigest:p.candidateDigest});expect(pruned.status).toBe(200);const generation=pruned.headers.get("agentflow-generation");await pruned.arrayBuffer();
  expect(readFileSync(join(directory,name))).toEqual(bytes);blocked=false;
  const unchangedState=readFileSync(join(directory,"state.json"));
  const record=JSON.parse(bytes.toString());
  if(delivery==="unsent"){
   const retained=join(f.dir,"retained-sequence-one.json");renameSync(join(directory,name),retained);
   const gap=await f.cli(["flush",flag,f.runId]);expect(gap.code,gap.stderr).toBe(3);expect(gap.stderr).toContain("missing_sequence");expect(readFileSync(retained)).toEqual(bytes);expect(readFileSync(join(directory,"state.json"))).toEqual(unchangedState);expect(readdirSync(directory).filter(n=>/^\d+-/.test(n))).toEqual([]);renameSync(retained,join(directory,name));
  }
  writeFileSync(join(directory,name),JSON.stringify({...record,digest:"0".repeat(64)}),{mode:0o600});const badDigest=readFileSync(join(directory,name));
  expect((await f.cli(["flush",flag,f.runId])).code).toBe(3);expect(readFileSync(join(directory,name))).toEqual(badDigest);expect(readFileSync(join(directory,"state.json"))).toEqual(unchangedState);
  if(delivery==="lost-ack"){
   const changed={...record.body,occurredAt:"2026-01-01T00:00:00.000Z"};writeFileSync(join(directory,name),JSON.stringify({...record,body:changed,digest:canonicalDigest(changed)}),{mode:0o600});const conflictBytes=readFileSync(join(directory,name));
   const conflict=await f.cli(["flush",flag,f.runId]);expect(conflict.code,conflict.stderr).toBe(3);expect(conflict.stderr).toContain("idempotency_conflict");expect(readFileSync(join(directory,name))).toEqual(conflictBytes);expect(readFileSync(join(directory,"state.json"))).toEqual(unchangedState);
  }
  writeFileSync(join(directory,name),bytes,{mode:0o600});
  const result=await f.cli(["flush",flag,f.runId]);expect(result.code,result.stderr).toBe(0);expect(replay!.generation).toBe(generation);
  if(original){expect(replay!.body).toEqual(original.body);expect(original.generation).not.toBe(generation);}
  expect(JSON.parse(result.stdout)).toMatchObject({eventId:JSON.parse(bytes.toString()).body.eventId,acceptedSequence:1,generation});
  expect(existsSync(join(directory,name))).toBe(false);const state=JSON.parse(readFileSync(join(directory,"state.json"),"utf8"));evidence.after={result,state,pending:readdirSync(directory).filter(n=>/^\d+-/.test(n)),generation};expect(state).toMatchObject({allocatedThrough:1,acknowledgedThrough:1});
  const stateBytes=readFileSync(join(directory,"state.json"));expect((await f.cli(["flush",flag,f.runId])).code).toBe(0);expect(readFileSync(join(directory,"state.json"))).toEqual(stateBytes);
  const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare(`SELECT count(*) n FROM ${kind==="task"?"run_events":"workflow_events"} WHERE event_id=?`).get(JSON.parse(bytes.toString()).body.eventId)).toEqual({n:1});}finally{db.close();}
 }finally{if(process.env.W03B_TASK3_PROOF_DIR)writeFileSync(join(process.env.W03B_TASK3_PROOF_DIR,`cli-${kind}-${delivery}.json`),JSON.stringify(evidence,null,2),{mode:0o600});await proxy.close();await server.stop();}
},40000);
