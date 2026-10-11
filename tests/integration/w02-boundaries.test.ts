import { eventInput } from "../../src/contracts/observations";
import { expect,it } from "vitest";
import { evidenceFixture } from "../fixtures/w02";
it("invalidates tuple approvals on implementation, replacement, work edits, reopen and rework, preserving metadata",async()=>{
 const f=await evidenceFixture();try{
  const id=f.create();f.policy(id);f.succeed(id);f.gate(id,"review","approved");
  f.send({kind:"task.patch",id,input:{expectedVersion:f.current(id).version,title:"metadata"}});
  expect(f.detail(id)).toMatchObject({evidence:{review:{approved:true},implementationCurrent:true}});
  f.artifact(id,"synthetic:B");expect(f.detail(id)).toMatchObject({evidence:{review:{approved:false},implementationCurrent:false}});
  f.gate(id,"review","approved","synthetic:B");expect(()=>f.complete(id)).toThrow("implementation_not_current");
  f.succeed(id,"synthetic:B");expect(f.detail(id)).toMatchObject({evidence:{review:{approved:false}}});
  f.gate(id,"review","approved","synthetic:B");f.complete(id);f.reopen(id);
  expect(f.detail(id)).toMatchObject({task:{workRevision:5,reworkRound:0},evidence:{currentArtifact:null,review:{approved:false}}});
  f.succeed(id);f.gate(id,"review","approved");
  f.send({kind:"task.patch",id,input:{expectedVersion:f.current(id).version,description:"new work"}});
  expect(f.detail(id)).toMatchObject({task:{status:"backlog"},evidence:{currentArtifact:null,review:{approved:false}}});
 }finally{f.owned.close();}
});
it("enforces both required gates, optional negatives and legacy execution-only success",async()=>{
 const f=await evidenceFixture();try{
  const id=f.create();f.policy(id,true,true);f.artifact(id,"synthetic:A");f.move(id,"review");
  expect(()=>f.register(id,"review")).toThrow("review_tuple_required");
  f.gate(id,"review","approved");expect(()=>f.complete(id)).toThrow("approval_required");
  f.gate(id,"verification","changes_requested");f.gate(id,"verification","approved");expect(()=>f.complete(id)).toThrow("changes_requested");
  f.send({kind:"task.rework",id,input:{expectedVersion:f.current(id).version,reason:"repair"}});f.artifact(id,"synthetic:A");f.gate(id,"review","approved");f.gate(id,"verification","approved");f.move(id,"review");expect(f.complete(id).status).toBe(201);
  const optional=f.create();f.artifact(optional,"synthetic:A");f.gate(optional,"review","changes_requested");f.move(optional,"review");expect(f.complete(optional).status).toBe(201);
  const legacy=f.create();const runId=f.register(legacy,"review");f.report(runId,1,"run.started");f.report(runId,2,"run.succeeded",{summary:"legacy execution"});f.policy(legacy);f.move(legacy,"review");expect(()=>f.complete(legacy)).toThrow("artifact_required");
 }finally{f.owned.close();}
});
it("rejects stale or inappropriate success atomically and preserves exact event receipts",async()=>{
 const f=await evidenceFixture();try{
  const id=f.create();f.artifact(id,"synthetic:A");const t=f.current(id);
  const runId=f.register(id,"review",{workRevision:t.workRevision,artifactRef:"synthetic:A",reworkRound:0});f.report(runId,1,"run.started");
  expect(()=>f.policy(id)).toThrow("active_run");expect(()=>f.artifact(id,"synthetic:B")).toThrow("active_run");
  const ack=f.report(runId,2,"run.succeeded",{summary:"yes",decision:"approved",evidenceNote:"checked"});
  f.move(id,"review");f.send({kind:"task.rework",id,input:{expectedVersion:f.current(id).version,reason:"new"}});
  const event=(f.owned.store.snapshot({kind:"events",id:runId,input:{limit:10}}).body.data as {items:{eventId:string;receivedAt:string}[]}).items.find(e=>e.eventId===(ack.body.data as {eventId:string}).eventId)!;
  const {receivedAt,...input}=event;void receivedAt;
  expect(f.send({kind:"run.event",id:runId,input:eventInput.parse(input)}).body).toEqual(ack.body);
  const bad=f.register(id,"implementation");f.report(bad,1,"run.started");expect(()=>f.report(bad,2,"run.succeeded",{summary:"wrong",decision:"approved",evidenceNote:"wrong"})).toThrow("decision_purpose_invalid");
  f.report(bad,2,"run.failed",{message:"failed"});f.move(id,"review");expect(()=>f.complete(id)).toThrow("implementation_not_current");
 }finally{f.owned.close();}
});
