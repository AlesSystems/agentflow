import { randomUUID } from "node:crypto";
import { expect,it } from "vitest";
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
