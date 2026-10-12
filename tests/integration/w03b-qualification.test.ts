import { expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync,realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openOwnedStore } from "../../src/db";
import { HistoryRuntime } from "../../src/history/runtime";
import { canonicalDigest } from "../../src/domain/request-digest";
import { qualifyRequests,retainControl } from "../fixtures/w03b-qualification";
for(const control of ["backup","integrity","stale candidate","transaction"] as const)it(`retains failed ${control} production prune in the campaign denominator`,async()=>{
 const owned=await openOwnedStore(mkdtempSync(join(realpathSync(tmpdir()),"w03b-helper-control-"))),runtime=new HistoryRuntime(owned.store),db=new Database(join(owned.store.dataDir,"agentflow.sqlite"));
 const ctx=(path:string,input:unknown)=>({principal:"operator" as const,method:"POST",path,key:randomUUID(),digest:canonicalDigest(input),now:Date.now()});
 try{
  const previewInput={cutoff:new Date(Date.now()-1000).toISOString()},preview=owned.store.historyPreview(previewInput,ctx("preview",previewInput)).body.data as {previewId:string;expectedGeneration:string;expectedVersion:number;candidateDigest:string};
  const input={previewId:preview.previewId,expectedGeneration:preview.expectedGeneration,expectedVersion:preview.expectedVersion,candidateDigest:preview.candidateDigest};
  if(control==="backup")owned.store.backup=async()=>{throw Error("controlled backup transfer failure");};
  if(control==="integrity"){db.pragma("foreign_keys=OFF");db.prepare("INSERT INTO task_dependencies VALUES(?,?,?)").run(randomUUID(),randomUUID(),randomUUID());}
  if(control==="stale candidate")owned.store.command({kind:"project.create",input:{name:"Changed synthetic candidates"}},ctx("project",{}));
  if(control==="transaction")db.exec("CREATE TRIGGER helper_fail_commit BEFORE UPDATE ON instance_metadata BEGIN SELECT RAISE(ABORT,'controlled transaction rollback'); END");
  const before=owned.store.metadata().generation;
  const result=await qualifyRequests([{id:"confirm",warmup:false},{id:"later",warmup:false}],async()=>{const reply=await runtime.prune(input,ctx("prune",input),new AbortController().signal);return {status:200,generation:reply.body.generation,text:JSON.stringify(reply.body),dispatchMs:0,drainedMs:1,elapsedMs:1};});
  retainControl(control,{control,...result});expect(result.acceptance).toBe(false);expect(result.expected).toBe(2);expect(result.attempted).toBe(1);expect(result.failed).toEqual(["confirm"]);expect(result.missing).toEqual(["later"]);expect(owned.store.metadata().generation).toBe(before);expect(db.prepare("SELECT count(*) n FROM retention_consumptions").get()).toEqual({n:0});expect(runtime.diagnostics().leases).toBe(0);
 }finally{db.close();await runtime.close();owned.close();}
});

import { qualifiedService } from "../fixtures/w03a-qualification";
import { boundedFetch,readBoundedText } from "../fixtures/w01-runtime";
import { validateRecovery } from "../fixtures/w03b-qualification";
import assert from "node:assert/strict";
for(const defect of ["missing visible reset","lost receipt"] as const)it(`invalidates actual ${defect} protocol observation without losing denominator`,async()=>{
 const services:unknown[]=[];
 await qualifiedService({},services,async(server,cookie)=>{
  const call=async(path:string,input:unknown,key=randomUUID())=>{const response=await boundedFetch(server.url+"/api/v1/retention/"+path,{method:"POST",headers:{Cookie:cookie,Origin:server.url,"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(input)});assert.equal(response.status,200);return {body:await response.json(),generation:response.headers.get("AgentFlow-Generation")!};};
  const preview=(await call("preview",{cutoff:new Date(Date.now()-1000).toISOString()})).body.data;
  const input={previewId:preview.previewId,expectedGeneration:preview.expectedGeneration,expectedVersion:preview.expectedVersion,candidateDigest:preview.candidateDigest},key=randomUUID();
  const original=await call("prune",input,key),retry=await call("prune",input,key);
  const reset=await boundedFetch(server.url+`/api/v1/changes/stream?after=0&generation=${preview.expectedGeneration}`,{headers:{Cookie:cookie}}),resetText=await readBoundedText(reset);
  const actual={priorGeneration:preview.expectedGeneration,generation:original.body.generation,resetText,originalReceipt:original.body,retryReceipt:retry.body,retryGeneration:retry.generation};validateRecovery(actual);
  const result=await qualifyRequests([{id:"protocol",warmup:false},{id:"later",warmup:false}],async()=>{validateRecovery({...actual,...(defect==="missing visible reset"?{resetText:resetText.replace("event: reset","event: change")}:{retryReceipt:{generation:retry.body.generation,data:{}}})});return {status:200,generation:actual.generation,text:JSON.stringify({generation:actual.generation}),dispatchMs:0,drainedMs:1,elapsedMs:1};});
  expect(result.acceptance).toBe(false);expect(result.expected).toBe(2);expect(result.attempted).toBe(1);expect(result.failed).toEqual(["protocol"]);expect(result.missing).toEqual(["later"]);retainControl(defect,{actual,...result});
 });
});
it("invalidates actual killed-service shutdown while retaining stream originals",async()=>{
 const services:unknown[]=[];
 const result=await qualifyRequests([{id:"service",warmup:false},{id:"later",warmup:false}],async()=>{await qualifiedService({},services,async server=>{server.child.kill("SIGKILL");});return {status:200,generation:randomUUID(),text:"{}",dispatchMs:0,drainedMs:1,elapsedMs:1};});
 expect(result.acceptance).toBe(false);expect(result.expected).toBe(2);expect(result.attempted).toBe(1);expect(result.failed).toEqual(["service"]);expect(result.missing).toEqual(["later"]);retainControl("shutdown failure",{services,...result});expect(services[0]).toMatchObject({closed:true,signalCode:"SIGKILL",cleanupFailure:expect.any(String),stdoutBase64:expect.any(String),stderrBase64:expect.any(String)});
});
it("launches the baseline with its explicitly qualified historical Node executable",async()=>{
 const historical=process.env.AGENTFLOW_W03B_HISTORICAL_ROOT;
 if(!historical)throw Error("qualified historical runtime prerequisite required");
 const nodeExecutable=join(historical,"runtime/bin/node"),services:unknown[]=[];
 await qualifiedService({nodeExecutable},services,async server=>{expect(server.child.spawnfile).toBe(nodeExecutable);});
 expect(services[0]).toMatchObject({nodeExecutable,exitCode:0,signalCode:null,closed:true});
});
it("captures export preparation residual and batch work separately from completed transfer",async()=>{
 const services:unknown[]=[];
 await qualifiedService({entry:"tests/fixtures/w03b-measure-server.ts"},services,async(server,cookie)=>{
  const snapshot=await boundedFetch(server.url+"/api/v1/foundation",{headers:{Cookie:cookie}}),generation=(await snapshot.json()).generation;
  const response=await boundedFetch(server.url+`/api/v1/export?content=attempts&generation=${generation}`,{headers:{Cookie:cookie}});expect(response.status).toBe(200);expect((await readBoundedText(response)).trim().split("\n").map(line=>JSON.parse(line).kind)).toEqual(["manifest","complete"]);
 });
 const stdout=(services[0] as {stdout:string}).stdout;
 const records=stdout.split("\n").filter(line=>line.startsWith("{")).map(line=>JSON.parse(line));
 const preparations=records.filter(row=>row.kind==="exportPreparationTiming"),batches=records.filter(row=>row.kind==="exportBatchTiming");
 expect(preparations).toHaveLength(1);expect(preparations[0]).toMatchObject({backupMs:expect.any(Number),totalMs:expect.any(Number),residualMs:expect.any(Number)});expect(preparations[0].residualMs).toBeGreaterThanOrEqual(0);expect(batches).toHaveLength(1);expect(batches[0]).toMatchObject({rows:0,ms:expect.any(Number)});retainControl("export-timing-separation",{services,records});
});
