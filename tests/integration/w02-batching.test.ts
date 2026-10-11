import { expect,it } from "vitest";
import { evidenceFixture } from "../fixtures/w02";
it("returns bounded current acceptance facts for every board task without loading decision history",async()=>{
 const f=await evidenceFixture();try{
  const prerequisite=f.create(),id=f.create();f.send({kind:"task.dependencies",id,input:{expectedVersion:1,prerequisiteIds:[prerequisite]}});
  const board=f.owned.store.snapshot({kind:"tracking.board",id:f.projectId,input:{limit:100}}).body.data as {columns:{items:unknown[]}[]};
  expect(board.columns.flatMap(column=>column.items)).toEqual(expect.arrayContaining([expect.objectContaining({id,readiness:{ready:false,blockedPrerequisiteIds:[prerequisite],prerequisites:[{taskId:prerequisite,status:"backlog",currentWorkRevision:1,acceptedWorkRevision:null,reason:"not_completed"}]},evidence:expect.objectContaining({currentArtifact:null,review:{required:false,approved:false,changesRequested:false,latestDecision:null}})})]));
 }finally{f.owned.close();}
});
