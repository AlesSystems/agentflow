import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { expect,it,vi } from "vitest";
import { workflowReadinessResponse } from "../../src/contracts/workflows";
import { evidenceFixture } from "../fixtures/w02";
it("reads current acceptance for all plan-linked tasks in one bounded revision snapshot including unreported history",async()=>{
 const f=await evidenceFixture();try{
  const prerequisite=f.create(),id=f.create();f.send({kind:"task.dependencies",id,input:{expectedVersion:1,prerequisiteIds:[prerequisite]}});
  const workflowId=randomUUID(),revisionId=randomUUID();f.send({kind:"workflow.create",input:{id:workflowId,projectId:f.projectId,name:"Current facts on historical plan"}});f.send({kind:"workflow.revision",id:workflowId,input:{id:revisionId,expectedWorkflowVersion:1,nodes:[{id:randomUUID(),label:"Linked",taskId:id},{id:randomUUID(),label:"Unknown"}],edges:[]}});
  const snapshot=f.owned.store.snapshot({kind:"workflow.readiness",id:workflowId,revisionId}).body;
  expect(snapshot.data).toMatchObject({workflowId,revisionId,tasks:[{id,readiness:{ready:false,blockedPrerequisiteIds:[prerequisite]}}]});
  f.move(prerequisite,"review");f.complete(prerequisite);
  expect(f.owned.store.snapshot({kind:"workflow.readiness",id:workflowId,revisionId}).body.data).toMatchObject({tasks:[{id,readiness:{ready:true}}]});
  expect(f.owned.store.snapshot({kind:"workflow.revision",id:workflowId,revisionId}).body.data).toMatchObject({id:revisionId,nodes:expect.any(Array),edges:[]});
 }finally{f.owned.close();}
});

type Fixture = Awaited<ReturnType<typeof evidenceFixture>>;
it("keeps parent grouping and reported plan edges independent of readiness, leaving unlinked nodes empty",async()=>{
 const f=await evidenceFixture();try{
  const parent=f.create(),child=f.create(),workflowId=randomUUID(),revisionId=randomUUID(),source=randomUUID(),target=randomUUID();
  f.send({kind:"task.patch",id:child,input:{expectedVersion:1,parentTaskId:parent}});
  f.send({kind:"workflow.create",input:{id:workflowId,projectId:f.projectId,name:"Synthetic grouping"}});
  f.send({kind:"workflow.revision",id:workflowId,input:{id:revisionId,expectedWorkflowVersion:1,nodes:[{id:source,label:"Unaccepted parent",taskId:parent},{id:target,label:"Grouped child",taskId:child}],edges:[{source,target}]}});
  const tasks=read(f,workflowId,revisionId).data.tasks;
  expect(tasks.map(task=>task.id).sort()).toEqual([parent,child].sort());
  for(const task of tasks){expect(task.status).toBe("backlog");expect(task.readiness).toEqual({ready:true,prerequisites:[],blockedPrerequisiteIds:[]});}
  const unlinked=randomUUID();
  f.send({kind:"workflow.revision",id:workflowId,input:{id:unlinked,expectedWorkflowVersion:2,nodes:[{id:randomUUID(),label:"Unknown task"}],edges:[]}});
  expect(read(f,workflowId,unlinked).data).toEqual({workflowId,revisionId:unlinked,tasks:[]});
 }finally{f.owned.close();}
});
function plan(f: Fixture, taskIds: string[]) {
 const workflowId=randomUUID(),revisionId=randomUUID();
 f.send({kind:"workflow.create",input:{id:workflowId,projectId:f.projectId,name:"Synthetic readiness coverage"}});
 f.send({kind:"workflow.revision",id:workflowId,input:{id:revisionId,expectedWorkflowVersion:1,nodes:taskIds.map(taskId=>({id:randomUUID(),label:"Linked task",taskId})),edges:[]}});
 return {workflowId,revisionId};
}
function read(f:Fixture,workflowId:string,revisionId:string) {
 return workflowReadinessResponse.parse(f.owned.store.snapshot({kind:"workflow.readiness",id:workflowId,revisionId}).body);
}
it("preserves historical membership and immutable plans while current prerequisite acceptance changes",async()=>{
 const f=await evidenceFixture();try{
  const prerequisite=f.create(),id=f.create(),later=f.create();
  f.send({kind:"task.dependencies",id,input:{expectedVersion:1,prerequisiteIds:[prerequisite]}});
  const {workflowId,revisionId}=plan(f,[id,id]);
  const original=f.owned.store.snapshot({kind:"workflow.revision",id:workflowId,revisionId}).body.data;
  const newRevision=randomUUID();
  f.send({kind:"workflow.revision",id:workflowId,input:{id:newRevision,expectedWorkflowVersion:2,nodes:[{id:randomUUID(),label:"Later member",taskId:later}],edges:[]}});
  const before=read(f,workflowId,revisionId);
  expect(before.data.tasks.map(task=>task.id)).toEqual([id]);
  expect(read(f,workflowId,newRevision).data.tasks.map(task=>task.id)).toEqual([later]);
  f.move(prerequisite,"review");f.complete(prerequisite);
  const accepted=read(f,workflowId,revisionId);
  expect(accepted.data.tasks[0].readiness).toEqual({ready:true,blockedPrerequisiteIds:[],prerequisites:[{taskId:prerequisite,status:"completed",currentWorkRevision:1,acceptedWorkRevision:1,reason:null}]});
  expect(accepted.generation).toBe(before.generation);
  expect(BigInt(accepted.snapshotCursor)).toBeGreaterThan(BigInt(before.snapshotCursor));
  f.reopen(prerequisite);
  expect(read(f,workflowId,revisionId).data.tasks[0]).toMatchObject({id,status:"backlog",readiness:{ready:false,blockedPrerequisiteIds:[prerequisite],prerequisites:[{taskId:prerequisite,currentWorkRevision:2,acceptedWorkRevision:1,reason:"not_completed"}]}});
  expect(f.owned.store.snapshot({kind:"workflow.revision",id:workflowId,revisionId}).body.data).toEqual(original);
 }finally{f.owned.close();}
});
it("shows current gate tuples and rejects another workflow's revision without changing historical reports",async()=>{
 const f=await evidenceFixture();try{
  const id=f.create(),nodeId=randomUUID(),workflowId=randomUUID(),revisionId=randomUUID(),runId=randomUUID();
  f.send({kind:"workflow.create",input:{id:workflowId,projectId:f.projectId,name:"Synthetic immutable reports"}});
  f.send({kind:"workflow.revision",id:workflowId,input:{id:revisionId,expectedWorkflowVersion:1,nodes:[{id:nodeId,label:"Reported success",taskId:id}],edges:[]}});
  f.send({kind:"workflow.run.register",input:{id:runId,workflowId,planRevisionId:revisionId}});
  f.send({kind:"workflow.run.event",id:runId,input:{schemaVersion:1,eventId:randomUUID(),workflowRunId:runId,sequence:1,occurredAt:"2026-10-11T00:00:00.000Z",type:"workflow.started",payload:{}}});
  f.send({kind:"workflow.run.event",id:runId,input:{schemaVersion:1,eventId:randomUUID(),workflowRunId:runId,sequence:2,occurredAt:"2026-10-11T00:00:01.000Z",type:"workflow.node.reported",payload:{nodeId,state:"succeeded"}}});
  const reports=f.owned.store.snapshot({kind:"workflow.events",id:runId,input:{limit:100}}).body.data;
  f.policy(id);f.artifact(id,"synthetic:A");f.gate(id,"review","approved");
  expect(read(f,workflowId,revisionId).data.tasks[0]).toMatchObject({id,projectId:f.projectId,status:"backlog",workRevision:1,reworkRound:0,evidence:{currentArtifact:{taskId:id,workRevision:1,artifactRef:"synthetic:A",reworkRound:0},review:{required:true,approved:true,changesRequested:false,latestDecision:{taskId:id,purpose:"review",decision:"approved",workRevision:1,artifactRef:"synthetic:A",reworkRound:0,evidenceNote:"Synthetic evidence"}}}});
  f.move(id,"review");f.send({kind:"task.rework",id,input:{expectedVersion:f.current(id).version,reason:"Synthetic rework"}});
  expect(read(f,workflowId,revisionId).data.tasks[0]).toMatchObject({status:"backlog",workRevision:2,reworkRound:1,evidence:{currentArtifact:null,review:{required:true,approved:false,changesRequested:false,latestDecision:null}}});
  expect(f.owned.store.snapshot({kind:"workflow.events",id:runId,input:{limit:100}}).body.data).toEqual(reports);
  const other=plan(f,[f.create()]);
  expect(()=>read(f,workflowId,other.revisionId)).toThrow("resource_not_found");
  expect(read(f,other.workflowId,other.revisionId).data.tasks).toHaveLength(1);
 }finally{f.owned.close();}
});
it("reads 100 linked tasks with a constant bounded SQL query count",async()=>{
 const f=await evidenceFixture();try{
  const ids=Array.from({length:100},()=>f.create()),small=plan(f,[ids[0]]),full=plan(f,ids);
  const prepare=vi.spyOn(Database.prototype,"prepare");
  try{
   const one=read(f,small.workflowId,small.revisionId),oneCount=prepare.mock.calls.length;
   prepare.mockClear();
   const hundred=read(f,full.workflowId,full.revisionId),hundredCount=prepare.mock.calls.length;
   expect(one.data.tasks.map(task=>task.id)).toEqual([ids[0]]);
   expect(hundred.data.tasks.map(task=>task.id).sort()).toEqual([...ids].sort());
   expect(hundred.data.tasks).toHaveLength(100);
   expect(hundred.data.tasks.every(task=>task.projectId===f.projectId&&task.readiness.ready)).toBe(true);
   expect(hundredCount).toBeLessThanOrEqual(oneCount+2);
   expect(hundredCount).toBeLessThanOrEqual(20);
  }finally{prepare.mockRestore();}
 }finally{f.owned.close();}
});
