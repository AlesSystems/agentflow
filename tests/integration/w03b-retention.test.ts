import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openOwnedStore } from "../../src/db";
import { canonicalDigest } from "../../src/domain/request-digest";
import type { ApplicationCommand } from "../../src/db/application";
import { eventInput } from "../../src/contracts/observations";

async function fixture(terminal=true) {
 const owned=await openOwnedStore(mkdtempSync(join(realpathSync(tmpdir()),"w03b-retention-")));
 const send=(command:ApplicationCommand,now=1000)=>owned.store.command(command,{principal:"operator",method:"POST",path:command.kind,key:randomUUID(),digest:canonicalDigest(command),now});
 const projectId=(send({kind:"project.create",input:{name:"Synthetic retention"}}).body.data as {id:string}).id;
 const agentId=(send({kind:"agent.create",input:{displayName:"Synthetic",source:"fixture",defaultRole:"implementation"}}).body.data as {id:string}).id;
 const taskId=(send({kind:"task.create",input:{projectId,title:"Synthetic task"}}).body.data as {id:string}).id;
 const runId=randomUUID();send({kind:"run.register",input:{id:runId,projectId,agentId,taskId,purpose:"implementation",expectedTaskVersion:1,workRevision:1}});
 const eventId=randomUUID();let progressCommand!:ApplicationCommand;let progressAck:unknown;
 for(const [sequence,type,payload] of [[1,"run.started",{}],[2,"run.progress",{message:"obsolete display body"}],[3,"run.succeeded",{summary:"terminal evidence"}]] as const)
 {if(!terminal&&sequence===3)continue;const command:ApplicationCommand={kind:"run.event",id:runId,input:eventInput.parse({schemaVersion:1,eventId:sequence===2?eventId:randomUUID(),runId,sequence,type,payload,occurredAt:new Date(1000).toISOString()})};const reply=send(command);if(sequence===2){progressCommand=command;progressAck=reply;}}
 const db=new Database(join(owned.store.dataDir,"agentflow.sqlite"));db.pragma("foreign_keys=ON");
 return {owned,db,send,progressCommand,progressAck,projectId,agentId,taskId,runId,eventId,close(){db.close();owned.close();}};
}
it("allows exactly the first eligible display-payload transition while preserving identity and ACK",async()=>{
 const f=await fixture();try {
  const old=f.db.prepare("SELECT * FROM run_events WHERE event_id=?").get(f.eventId) as Record<string,unknown>;
  expect(()=>f.db.prepare("UPDATE run_events SET body=json_set(body,'$.payload',NULL),payload_pruned_at=2000 WHERE event_id=?").run(f.eventId)).not.toThrow();
  const current=f.db.prepare("SELECT * FROM run_events WHERE event_id=?").get(f.eventId) as Record<string,unknown>;
  expect(JSON.parse(current.body as string).payload).toBe(null);
  for(const key of Object.keys(old).filter(key=>!["body","payload_pruned_at"].includes(key)))expect(current[key]).toEqual(old[key]);
 }finally{f.close();}
});

import { launch, pair } from "../fixtures/server";
it("browser preview promises a bounded prune and prune retains the paired session",async()=>{
 const server=await launch();try {
  const cookie=await pair(server);const headers={Cookie:cookie,Origin:server.url,"Content-Type":"application/json"};
  const request=async(path:string,input:unknown,key=randomUUID())=>fetch(server.url+"/api/v1/retention/"+path,{method:"POST",headers:{...headers,"Idempotency-Key":key},body:JSON.stringify(input)});
  const response=await request("preview",{cutoff:new Date(Date.now()-1000).toISOString()});
  expect(response.status).toBe(200);
  const preview=(await response.json()).data;expect(preview.counts).toEqual({eventPayloads:0,changes:0});
  const input={previewId:preview.previewId,expectedGeneration:preview.expectedGeneration,expectedVersion:preview.expectedVersion,candidateDigest:preview.candidateDigest};const key=randomUUID();
  const prune=await request("prune",input,key);expect(prune.status).toBe(200);const body=await prune.json();
  expect(body.generation).not.toBe(preview.expectedGeneration);expect(prune.headers.get("AgentFlow-Generation")).toBe(body.generation);
  const replay=await request("prune",input,key);expect(await replay.json()).toEqual(body);
  const reporter=await fetch(server.url+"/api/v1/retention/prune",{method:"POST",headers:{Authorization:"Bearer "+server.credentials().reporterToken,"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(input)});expect(reporter.status).toBe(403);expect(reporter.headers.get("AgentFlow-Generation")).toBe(body.generation);
  const changed=await request("prune",{...input,candidateDigest:"0".repeat(64)},key);expect(changed.status).toBe(409);expect((await changed.json()).error.code).toBe("idempotency_conflict");expect(changed.headers.get("AgentFlow-Generation")).toBe(body.generation);
  const later=await request("preview",{cutoff:new Date(Date.now()-1000).toISOString()});const next=(await later.json()).data;
  const nextReply=await request("prune",{previewId:next.previewId,expectedGeneration:next.expectedGeneration,expectedVersion:next.expectedVersion,candidateDigest:next.candidateDigest});expect(nextReply.status).toBe(200);const newest=(await nextReply.json()).generation;
  const historical=await request("prune",input,key);expect(await historical.json()).toEqual(body);expect(historical.headers.get("AgentFlow-Generation")).toBe(newest);
  expect((await fetch(server.url+"/api/v1/foundation",{headers:{Cookie:cookie}})).status).toBe(200);
 }finally{await server.stop();}
},40000);

import { vi } from "vitest";
import { HistoryRuntime } from "../../src/history/runtime";
import { retentionPreview, retentionPrune } from "../../src/contracts/history";
import type { CommandContext } from "../../src/db/application";
import { eventsResponse } from "../../src/contracts/observations";
import { activityResponse, trackingRunResponse } from "../../src/contracts/tracking";
const context=(path:string,input:unknown,now=Date.now(),key=randomUUID()):CommandContext=>({principal:"operator",method:"POST",path,key,digest:canonicalDigest(input),now});
function preview(f:Awaited<ReturnType<typeof fixture>>,cutoff=2000,now=Date.now()) {
 const input={cutoff:new Date(cutoff).toISOString()};const ctx=context("preview",input,now);
 const result=f.owned.store.historyPreview(input,ctx);const data=retentionPreview.parse(result.body.data);
 const pruneInput={previewId:data.previewId,expectedGeneration:data.expectedGeneration,expectedVersion:data.expectedVersion,candidateDigest:data.candidateDigest};
 return {data,input,ctx,result,pruneInput,pruneContext:context("prune",pruneInput,now)};
}
it("rejects direct SQL identity, ACK, digest, timestamp, restoration, replacement and malformed stub bypasses",async()=>{
 const f=await fixture();try {
  const old=f.db.prepare("SELECT * FROM run_events WHERE event_id=?").get(f.eventId);
  for(const mutation of ["event_id=NULL","run_id=NULL","sequence=NULL","type=NULL","digest=NULL","acknowledgement=NULL","occurred_at=NULL","received_at=NULL","digest='changed'","acknowledgement='{}'","sequence=99","body='{}'","body=json_set(body,'$.other',1)"])
   expect(()=>f.db.prepare(`UPDATE run_events SET body=json_set(body,'$.payload',NULL),payload_pruned_at=2000,${mutation} WHERE event_id=?`).run(f.eventId),mutation).toThrow();
  expect(f.db.prepare("SELECT * FROM run_events WHERE event_id=?").get(f.eventId)).toEqual(old);
  expect(()=>f.db.prepare("DELETE FROM run_events WHERE event_id=?").run(f.eventId)).toThrow("immutable");
  expect(()=>f.db.prepare("INSERT OR REPLACE INTO run_events SELECT * FROM run_events WHERE event_id=?").run(f.eventId)).toThrow("immutable");
  for(const [body,marked] of [["{\"payload\":null}",null],["{\"payload\":{}}",2000],["{}",null]] as const)
   expect(()=>f.db.prepare("INSERT INTO run_events VALUES(?,?,99,'run.progress','digest',?,'{}',1000,1000,?)").run(randomUUID(),f.runId,body,marked)).toThrow();
  f.db.prepare("UPDATE run_events SET body=json_set(body,'$.payload',NULL),payload_pruned_at=2000 WHERE event_id=?").run(f.eventId);
  for(const sql of ["payload_pruned_at=3000","payload_pruned_at=NULL","body=json_set(body,'$.payload',json('{}'))"])
   expect(()=>f.db.prepare(`UPDATE run_events SET ${sql} WHERE event_id=?`).run(f.eventId)).toThrow("immutable");
 }finally{f.close();}
});
it("retains_every_protected_fact and all workflow payloads, while readers expose honest stubs",async()=>{
 const f=await fixture();try {
  const protectedIds:string[]=[];
  for(const protection of ["active","equal","future","completion","artifact","decision","node"]){
   const taskId=(f.send({kind:"task.create",input:{projectId:f.projectId,title:protection}}).body.data as {id:string}).id;
   const runId=randomUUID();f.send({kind:"run.register",input:{id:runId,projectId:f.projectId,agentId:f.agentId,taskId,purpose:"implementation",expectedTaskVersion:1,workRevision:1}});
   const eventId=randomUUID();if(!["equal","future"].includes(protection))protectedIds.push(eventId);
   for(const [sequence,type,payload] of [[1,"run.started",{}],[2,"run.progress",{message:protection}],[3,"run.succeeded",{summary:"retained terminal"}]] as const){
    if(sequence===3&&protection==="active")continue;
    f.send({kind:"run.event",id:runId,input:eventInput.parse({schemaVersion:1,eventId:sequence===2?eventId:randomUUID(),runId,sequence,type,payload,occurredAt:new Date(1000).toISOString()})},protection==="equal"?2000:protection==="future"?3000:1000);
   }
   if(protection==="completion") {
    const value=f.owned.store.snapshot({kind:"task",id:taskId,input:{history:"both",historyLimit:10}}).body.data as {task:{version:number}};
    f.send({kind:"task.complete",id:taskId,input:{expectedVersion:value.task.version,evidenceNote:"Synthetic operator-role acceptance"}});
   }
   if(protection==="artifact")f.db.prepare("INSERT INTO task_artifacts VALUES(?,?,?,1,'synthetic',0,'operator',NULL,1000)").run(randomUUID(),taskId,runId);
   if(protection==="decision")f.db.prepare("INSERT INTO gate_decisions VALUES(?,?,?,?,1,'synthetic',0,'review','approved','Synthetic gate',1000)").run(randomUUID(),taskId,runId,eventId);
   if(protection==="node"){
    const workflowId=randomUUID(),revisionId=randomUUID(),workflowRunId=randomUUID(),nodeId=randomUUID();
    f.send({kind:"workflow.create",input:{id:workflowId,projectId:f.projectId,name:"Synthetic graph"}});
    f.send({kind:"workflow.revision",id:workflowId,input:{id:revisionId,expectedWorkflowVersion:1,nodes:[{id:nodeId,label:"Node",taskId}],edges:[]}});
    f.send({kind:"workflow.run.register",input:{id:workflowRunId,workflowId,planRevisionId:revisionId}});
    for(const [sequence,type,payload] of [[1,"workflow.started",{}],[2,"workflow.node.reported",{nodeId,runId,state:"succeeded"}],[3,"workflow.heartbeat",{}]] as const)
     f.send({kind:"workflow.run.event",id:workflowRunId,input:{schemaVersion:1,eventId:randomUUID(),workflowRunId,sequence,type,payload,occurredAt:new Date(1000).toISOString()} as never});
   }
  }
  const tables=["projects","tasks","agents","runs","run_registrations","run_order_allocator","completions","task_artifacts","gate_decisions","task_dependencies","workflow_events","workflow_node_observations","workflow_revisions","workflow_runs","workflow_run_registrations","workflow_order_allocator","run_closures","receipts"];
  const before=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t}`).all()]));
  const protectedEvents=f.db.prepare("SELECT * FROM run_events WHERE event_id<>?").all(f.eventId);
  f.owned.store.createSession("synthetic-session",1000,Date.now()+100000);
  const p=preview(f);expect(p.data.counts.eventPayloads).toBe(1);
  const runtime=new HistoryRuntime(f.owned.store);const result=await runtime.prune(p.pruneInput,p.pruneContext,new AbortController().signal);
  expect(retentionPrune.parse(result.body.data).applied.eventPayloads).toBe(1);expect(f.owned.store.sessionCount()).toBe(1);expect(f.send(f.progressCommand).body).toEqual((f.progressAck as {body:unknown}).body);
  for(const table of tables.filter(t=>t!=="receipts"))expect(f.db.prepare(`SELECT * FROM ${table}`).all(),table).toEqual(before[table]);
  for(const receipt of before.receipts as Record<string,unknown>[])expect(f.db.prepare("SELECT * FROM receipts WHERE principal=? AND method=? AND path=? AND key=?").get(receipt.principal,receipt.method,receipt.path,receipt.key)).toEqual(receipt);
  expect(f.db.prepare("SELECT * FROM run_events WHERE event_id<>?").all(f.eventId)).toEqual(protectedEvents);
  for(const eventId of protectedIds)expect(()=>f.db.prepare("UPDATE run_events SET body=json_set(body,'$.payload',NULL),payload_pruned_at=4000 WHERE event_id=?").run(eventId)).toThrow("immutable");
  const events=eventsResponse.parse(f.owned.store.snapshot({kind:"events",id:f.runId,input:{limit:10}}).body);
  expect(events.data.items.find(e=>e.eventId===f.eventId)).toMatchObject({payload:null,payloadPrunedAt:retentionPrune.parse(result.body.data).prunedAt});
  const copy=join(f.owned.store.dataDir,"backups","export-after-prune.sqlite");const exported=await f.owned.store.prepareHistoryExport(copy,{content:["attempts"],generation:result.body.generation},new AbortController().signal);
  const records=[];for(;;){const batch=exported.nextBatch();if(!batch.length)break;records.push(...batch);}exported.close();
  expect(records.find(row=>row.kind==="runEvent" && row.data.eventId===f.eventId)?.data).toMatchObject({payload:null,payloadPrunedAt:retentionPrune.parse(result.body.data).prunedAt});
  activityResponse.parse(f.owned.store.snapshot({kind:"activity",input:{limit:100}}).body);
  const summary=trackingRunResponse.parse(f.owned.store.snapshot({kind:"tracking.run",id:f.runId}).body);expect(summary.data.message).toBe("terminal evidence");
  await runtime.close();
 }finally{f.close();}
});
it("preview_guards_backup_and_commit: backup failure, added protection, transactional rollback and original retry",async()=>{
 const f=await fixture();const runtime=new HistoryRuntime(f.owned.store);try {
  const p=preview(f);const generation=f.owned.store.metadata().generation;
  const backup=vi.spyOn(f.owned.store,"backup").mockRejectedValueOnce(new Error("synthetic backup failure"));
  await expect(runtime.prune(p.pruneInput,p.pruneContext,new AbortController().signal)).rejects.toThrow("synthetic backup failure");
  expect(f.owned.store.metadata().generation).toBe(generation);expect(f.db.prepare("SELECT version FROM retention_state").get()).toEqual({version:1});
  let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;});
  backup.mockRestore();const actual=f.owned.store.backup.bind(f.owned.store);
  const held=vi.spyOn(f.owned.store,"backup").mockImplementation(async(...args)=>{const value=await actual(...args);await hold;return value;});
  const pending=runtime.prune(p.pruneInput,p.pruneContext,new AbortController().signal);
  f.db.prepare("INSERT INTO task_artifacts VALUES(?,?,?,1,'synthetic',0,'operator',NULL,1000)").run(randomUUID(),f.taskId,f.runId);
  release();await expect(pending).rejects.toThrow("preview_changed");held.mockRestore();
  expect(f.owned.store.metadata().generation).toBe(generation);expect(f.db.prepare("SELECT payload_pruned_at FROM run_events WHERE event_id=?").get(f.eventId)).toEqual({payload_pruned_at:null});
  const fresh=preview(f);f.db.exec("CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON receipts WHEN NEW.path='prune' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;");
  await expect(runtime.prune(fresh.pruneInput,fresh.pruneContext,new AbortController().signal)).rejects.toThrow("synthetic rollback");
  expect(f.owned.store.metadata().generation).toBe(generation);expect(f.db.prepare("SELECT version FROM retention_state").get()).toEqual({version:1});
  f.db.exec("DROP TRIGGER synthetic_receipt_failure");const count=vi.spyOn(f.owned.store,"backup");const reply=await runtime.prune(fresh.pruneInput,fresh.pruneContext,new AbortController().signal);
  const state=f.db.prepare("SELECT * FROM changes").all();expect(await runtime.prune(fresh.pruneInput,{...fresh.pruneContext,now:Date.now()+999999},new AbortController().signal)).toEqual(reply);expect(count).toHaveBeenCalledTimes(1);expect(f.db.prepare("SELECT * FROM changes").all()).toEqual(state);
  await expect(runtime.prune(fresh.pruneInput,{...fresh.pruneContext,principal:"reporter"},new AbortController().signal)).rejects.toThrow("human_required");
  count.mockRestore();
 }finally{await runtime.close();f.close();}
});

import { validateMigrationSql } from "../../src/db/migration-sql";
it("admits the bounded transactional DROP TRIGGER prerequisite without weakening migration statement guards",()=>{
 expect(()=>validateMigrationSql("DROP TRIGGER run_events_no_update;")).not.toThrow();
 for(const sql of ["DROP TRIGGER run_events_no_update; COMMIT;","DROP TRIGGER;","DROP TRIGGER unrelated_trigger;","DROP TRIGGER IF EXISTS run_events_no_update;","DROP TRIGGER run_events_no_update ATTACH 'x';"])
  expect(()=>validateMigrationSql(sql)).toThrow("NONTRANSACTIONAL_MIGRATION");
});

import { readdirSync, readFileSync, statSync } from "node:fs";
it("bounds each tranche at 0, 1, 1000 and 1001 with deterministic digest and an advancing non-reusing cursor",async()=>{
 for(const count of [0,1,1000,1001]){
  const f=await fixture();try {
   // All fixture-only additions use valid intact envelopes; production cannot insert stubs.
   if(count===0)f.db.prepare("UPDATE runs SET state='running' WHERE id=?").run(f.runId);
   const start=count?1:0;
   for(let i=start;i<count;i++){
    const eventId=randomUUID(),sequence=4+i;const body={schemaVersion:1,eventId,runId:f.runId,sequence,type:"run.heartbeat",payload:{},occurredAt:new Date(1000).toISOString(),receivedAt:new Date(1000).toISOString()};
    f.db.prepare("INSERT INTO run_events VALUES(?,?,?,'run.heartbeat',?,?,?,1000,1000,NULL)").run(eventId,f.runId,sequence,canonicalDigest(body),JSON.stringify(body),"{}");
   }
   f.db.prepare("UPDATE changes SET received_at=4000").run();
   for(let i=0;i<count;i++)f.db.prepare("INSERT INTO changes(entity_type,entity_id,project_id,kind,received_at) VALUES('synthetic',?,NULL,'old',1000)").run(String(i));
   f.db.prepare("INSERT INTO changes(entity_type,entity_id,project_id,kind,received_at) VALUES('synthetic','newest',NULL,'new',1000)").run();
   const p=preview(f),same=preview(f);expect(p.data.counts).toEqual({eventPayloads:Math.min(count,1000),changes:Math.min(count,1000)});expect(p.data.hasMore).toEqual({eventPayloads:count>1000,changes:count>1000});expect(same.data.candidateDigest).toBe(p.data.candidateDigest);
   const before=f.owned.store.changeBatch("0").maximum;const sequence=(f.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='changes'").get() as {seq:number}).seq;
   const admission=f.owned.store.historyAdmitPrune(p.pruneInput,p.pruneContext);if("body" in admission)throw new Error("unexpected replay");
   const reply=f.owned.store.historyCommitPrune(admission,Date.now());expect(BigInt(reply.body.snapshotCursor)).toBeGreaterThan(BigInt(before));expect((f.db.prepare("SELECT seq FROM sqlite_sequence WHERE name='changes'").get() as {seq:number}).seq).toBeGreaterThan(sequence);
   expect(f.db.prepare("SELECT count(*) n FROM run_events WHERE payload_pruned_at IS NOT NULL").get()).toEqual({n:Math.min(count,1000)});
  }finally{f.close();}
 }
});
it("enforces preview capacity, exact expiry, current candidates/generation/version and strict cutoff guards",async()=>{
 const f=await fixture();try {
  const now=Date.now(),p=preview(f,2000,now);
  expect(()=>f.owned.store.historyAdmitPrune(p.pruneInput,{...p.pruneContext,now:now+300000})).toThrow("preview_expired");
  expect(f.owned.store.historyPreview(p.input,{...p.ctx,now:now+300000})).toEqual(p.result);
  expect(()=>f.owned.store.historyAdmitPrune({...p.pruneInput,previewId:randomUUID()},p.pruneContext)).toThrow("preview_expired");
  for(const input of [{...p.pruneInput,expectedGeneration:randomUUID()},{...p.pruneInput,expectedVersion:2},{...p.pruneInput,candidateDigest:"0".repeat(64)}])expect(()=>f.owned.store.historyAdmitPrune(input,p.pruneContext)).toThrow("preview_changed");
  expect(()=>f.owned.store.historyPreview({cutoff:new Date(now+1).toISOString()},context("preview",{},now))).toThrow("cutoff_invalid");
  expect(()=>f.owned.store.historyPreview({cutoff:"2026-01-01T00:00:00+01:00"},context("preview",{},now))).toThrow();
  for(let i=1;i<20;i++)preview(f,2000,now);
  expect(()=>preview(f,2000,now)).toThrow("preview_limit");
  preview(f,2000,now+300000);expect((f.db.prepare("SELECT count(*) n FROM retention_previews").get() as {n:number}).n).toBe(1);
  const late=preview(f);f.db.prepare("INSERT INTO changes(entity_type,entity_id,project_id,kind,received_at) VALUES('synthetic','late',NULL,'late',1000)").run();
  expect(()=>f.owned.store.historyAdmitPrune(late.pruneInput,late.pruneContext)).toThrow("preview_changed");
  expect(f.db.prepare("SELECT count(*) n FROM receipts WHERE path='prune'").get()).toEqual({n:0});
 }finally{f.close();}
});
it("shares exact in-flight confirmations, cancels all waiters before commit, and retains completed recovery backups",async()=>{
 const f=await fixture();const runtime=new HistoryRuntime(f.owned.store);try {
  const p=preview(f);const actual=f.owned.store.backup.bind(f.owned.store);let release!:()=>void;let backed!:()=>void;
  const hold=new Promise<void>(resolve=>{release=resolve;}),finished=new Promise<void>(resolve=>{backed=resolve;});
  const backup=vi.spyOn(f.owned.store,"backup").mockImplementation(async(...args)=>{const value=await actual(...args);backed();await hold;return value;});
  const a=new AbortController(),b=new AbortController();const first=runtime.prune(p.pruneInput,p.pruneContext,a.signal);const second=runtime.prune(p.pruneInput,p.pruneContext,b.signal);
  const checked=Promise.allSettled([first,second]);await finished;
  await expect(runtime.prune(p.pruneInput,{...p.pruneContext,key:randomUUID()},new AbortController().signal)).rejects.toThrow("retention_busy");
  await expect(runtime.prune(p.pruneInput,{...p.pruneContext,digest:"different"},new AbortController().signal)).rejects.toThrow("idempotency_conflict");
  b.abort();release();const results=await checked;expect(results.map(r=>r.status)).toEqual(["rejected","rejected"]);expect((results[0] as PromiseRejectedResult).reason).toBe((results[1] as PromiseRejectedResult).reason);expect(backup).toHaveBeenCalledTimes(1);backup.mockRestore();
  expect(f.owned.store.metadata().generation).toBe(p.data.expectedGeneration);expect(f.db.prepare("SELECT count(*) n FROM receipts WHERE path='prune'").get()).toEqual({n:0});
  const files=readdirSync(join(f.owned.store.dataDir,"backups")).filter(name=>name.startsWith("retention-")&&name.endsWith(".sqlite"));expect(files).toHaveLength(1);expect(statSync(join(f.owned.store.dataDir,"backups",files[0])).mode&0o777).toBe(0o600);
  const fresh=new AbortController();const reply=await runtime.prune(p.pruneInput,p.pruneContext,fresh.signal);fresh.abort();expect(await runtime.prune(p.pruneInput,p.pruneContext,new AbortController().signal)).toEqual(reply);
  expect(readFileSync(join(f.owned.store.dataDir,"backups",files[0])).length).toBeGreaterThan(0);
 }finally{await runtime.close();f.close();}
});

import { spawn } from "node:child_process";
it("settles real native caller abort and shutdown after backup without phantom receipts",async()=>{
 const child=spawn(process.execPath,["--import","tsx","tests/fixtures/w03b-retention-runtime.ts"],{stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);const timer=setTimeout(()=>child.kill("SIGKILL"),30000);const exit=await new Promise<number|null>(resolve=>child.once("close",resolve));clearTimeout(timer);expect(exit,stdout+stderr).toBe(0);expect(stdout).toContain('"cancelledBeforeCommit":true');expect(stdout).toContain('"shutdownBeforeCommit":true');console.log(stdout);
},35000);

import { restore } from "../../src/db/recovery";
it("keeps the change allocator and original prune receipt across restart and recovery backup restore",async()=>{
 const f=await fixture();const p=preview(f);const runtime=new HistoryRuntime(f.owned.store);
 const reply=await runtime.prune(p.pruneInput,p.pruneContext,new AbortController().signal);await runtime.close();
 const backup=join(f.owned.store.dataDir,"backups","after-prune.sqlite");await f.owned.store.backup(backup);const dir=f.owned.store.dataDir;
 const sequence=f.db.prepare("SELECT * FROM sqlite_sequence WHERE name='changes'").get();f.close();
 let owned=await openOwnedStore(dir);try {expect(owned.store.historyAdmitPrune(p.pruneInput,p.pruneContext)).toEqual(reply);}finally{owned.close();}
 let db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});expect(db.prepare("SELECT * FROM sqlite_sequence WHERE name='changes'").get()).toEqual(sequence);db.close();
 await restore(dir,backup);owned=await openOwnedStore(dir);try {expect(owned.store.sessionCount()).toBe(0);expect(owned.store.metadata().generation).not.toBe(reply.body.generation);expect(owned.store.historyAdmitPrune(p.pruneInput,p.pruneContext)).toEqual(reply);}finally{owned.close();}
 db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});expect(db.prepare("SELECT * FROM sqlite_sequence WHERE name='changes'").get()).toEqual(sequence);db.close();
});
it("rolls back the additive migration including replacement guard, state, column and old checksums",async()=>{
 const {migrations}=await import("../../src/db");const {createHash}=await import("node:crypto");
 for(const checkpoint of ["ALTER TABLE run_events","DROP TRIGGER run_events_no_update","CREATE TRIGGER run_events_intact_insert"]){
  const dir=mkdtempSync(join(realpathSync(tmpdir()),"w03b-migration-"));const prefix=migrations.slice(0,9);const owned=await openOwnedStore(dir,prefix);owned.close();
  const inspect=()=>{const db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});try{return {schema:db.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY name").all(),history:db.prepare("SELECT * FROM migration_history ORDER BY id").all(),metadata:db.prepare("SELECT * FROM instance_metadata").get()};}finally{db.close();}};
  const before=inspect(),original=migrations[9],start=original.sql.indexOf(checkpoint),end=checkpoint.startsWith("CREATE TRIGGER")?original.sql.indexOf("END;",start)+4:original.sql.indexOf(";",start)+1;
  const sql=original.sql.slice(0,end)+"\nINSERT INTO synthetic_missing_table VALUES(1);";
  await expect(openOwnedStore(dir,[...prefix,{id:original.id,sql,sha256:createHash("sha256").update(sql).digest("hex")}])).rejects.toThrow();expect(inspect()).toEqual(before);
 }
});
it("labels an interrupted run's latest pruned tracking message with its prune timestamp",async()=>{
 const f=await fixture(false),runtime=new HistoryRuntime(f.owned.store);try {
  const run=f.owned.store.snapshot({kind:"run",id:f.runId},100000).body.data as {version:number};
  f.send({kind:"run.close",id:f.runId,input:{expectedVersion:run.version,reason:"Synthetic operator stale closure"}},100000);
  const p=preview(f),reply=await runtime.prune(p.pruneInput,p.pruneContext,new AbortController().signal);
  const summary=trackingRunResponse.parse(f.owned.store.snapshot({kind:"tracking.run",id:f.runId}).body);
  expect(summary.data).toMatchObject({state:"interrupted",message:null,messagePrunedAt:retentionPrune.parse(reply.body.data).prunedAt});
 }finally{await runtime.close();f.close();}
});
it("rolls back selected payload removals and deleted changes when receipt insertion fails",async()=>{
 const f=await fixture(),runtime=new HistoryRuntime(f.owned.store);try {
  f.owned.store.createSession("synthetic-rollback-session",1000,Date.now()+100000);
  const p=preview(f);expect(p.data.counts.eventPayloads).toBe(1);expect(p.data.counts.changes).toBeGreaterThan(0);
  const tables=["run_events","changes","sqlite_sequence","instance_metadata","retention_state","retention_consumptions","sessions","receipts"];
  const state=()=>Object.fromEntries(tables.map(table=>[table,f.db.prepare(`SELECT * FROM ${table}`).all()]));
  const before=state();f.db.exec("CREATE TRIGGER synthetic_payload_failure BEFORE INSERT ON receipts WHEN NEW.path='prune' BEGIN SELECT RAISE(ABORT,'synthetic payload rollback'); END;");
  await expect(runtime.prune(p.pruneInput,p.pruneContext,new AbortController().signal)).rejects.toThrow("synthetic payload rollback");
  expect(state()).toEqual(before);
  expect(readdirSync(join(f.owned.store.dataDir,"backups")).filter(name=>name.startsWith("retention-")&&name.endsWith(".sqlite"))).toHaveLength(1);
 }finally{await runtime.close();f.close();}
});

import { mkdirSync, unlinkSync } from "node:fs";
it("recovers original and new prune intents after an actual synchronous backup-directory failure",async()=>{
 for(const retry of ["original","new"]){
  const f=await fixture(),runtime=new HistoryRuntime(f.owned.store);try {
   const p=preview(f),backupPath=join(f.owned.store.dataDir,"backups");
   const {writeFileSync}=await import("node:fs");writeFileSync(backupPath,"Synthetic non-directory fault",{mode:0o600});
   const tables=["run_events","changes","sqlite_sequence","instance_metadata","retention_state","retention_consumptions","sessions","receipts"];
   const state=()=>Object.fromEntries(tables.map(table=>[table,f.db.prepare(`SELECT * FROM ${table}`).all()]));const before=state();
   const backup=vi.spyOn(f.owned.store,"backup");
   await expect(runtime.prune(p.pruneInput,p.pruneContext,new AbortController().signal)).rejects.toThrow("INVALID_DIRECTORY");
   expect(runtime.diagnostics().leases).toBe(0);expect(state()).toEqual(before);expect(backup).toHaveBeenCalledTimes(0);
   unlinkSync(backupPath);mkdirSync(backupPath,{mode:0o700});
   const ctx=retry==="original"?p.pruneContext:{...p.pruneContext,key:randomUUID()};
   const reply=await runtime.prune(p.pruneInput,ctx,new AbortController().signal);
   expect(retentionPrune.parse(reply.body.data).applied.eventPayloads).toBe(1);expect(backup).toHaveBeenCalledTimes(1);expect(runtime.diagnostics().leases).toBe(0);
   expect(f.db.prepare("SELECT count(*) n FROM receipts WHERE path='prune'").get()).toEqual({n:1});backup.mockRestore();
  }finally{await runtime.close();f.close();}
 }
});
it("replays committed A before busy B while rejecting changed A, reporter A and new uncommitted C",async()=>{
 const f=await fixture(),runtime=new HistoryRuntime(f.owned.store);let release:()=>void=()=>{};try {
  const a=preview(f),original=await runtime.prune(a.pruneInput,a.pruneContext,new AbortController().signal);
  const b=preview(f),actual=f.owned.store.backup.bind(f.owned.store);let backed!:()=>void;
  const finished=new Promise<void>(resolve=>{backed=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const backup=vi.spyOn(f.owned.store,"backup").mockImplementation(async(...args)=>{const result=await actual(...args);backed();await hold;return result;});
  const controller=new AbortController();const pending=runtime.prune(b.pruneInput,b.pruneContext,controller.signal);const settlement=Promise.allSettled([pending]);await finished;
  const tables=["run_events","changes","sqlite_sequence","instance_metadata","retention_state","retention_consumptions","sessions","receipts"];
  const state=()=>Object.fromEntries(tables.map(table=>[table,f.db.prepare(`SELECT * FROM ${table}`).all()]));const before=state();
  expect(await runtime.prune(a.pruneInput,a.pruneContext,new AbortController().signal)).toEqual(original);
  const changed={...a.pruneInput,candidateDigest:"0".repeat(64)};
  await expect(runtime.prune(changed,{...a.pruneContext,digest:canonicalDigest(changed)},new AbortController().signal)).rejects.toThrow("idempotency_conflict");
  await expect(runtime.prune(a.pruneInput,{...a.pruneContext,principal:"reporter"},new AbortController().signal)).rejects.toThrow("human_required");
  const invalid={...b.pruneInput,previewId:randomUUID()},c=context("prune",invalid);
  const admission=vi.spyOn(f.owned.store,"historyAdmitPrune");
  await expect(runtime.prune(invalid,c,new AbortController().signal)).rejects.toThrow("retention_busy");expect(admission).not.toHaveBeenCalled();
  expect(backup).toHaveBeenCalledTimes(1);expect(state()).toEqual(before);expect(f.db.prepare("SELECT count(*) n FROM receipts WHERE path='prune' AND key=?").get(c.key)).toEqual({n:0});admission.mockRestore();
  controller.abort();release();expect((await settlement)[0].status).toBe("rejected");backup.mockRestore();expect(runtime.diagnostics().leases).toBe(0);
 }finally{release();await runtime.close();f.close();}
});
