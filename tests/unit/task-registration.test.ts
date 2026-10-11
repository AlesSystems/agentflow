import { expect,it } from "vitest";
import { taskRegistrationResponse,taskCreationPreference } from "../../src/contracts/task-registration";
it("bounds strict task registration metadata even at maximum cursor width",()=>{
 const id="ffffffff-ffff-4fff-8fff-ffffffffffff",body={data:{kind:"task",id,projectId:id,parentTaskId:id,assignedAgentId:id,version:1,workRevision:1},generation:id,snapshotCursor:"9223372036854775807"};expect(taskRegistrationResponse.safeParse(body).success).toBe(true);expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(1024);
 for(const change of[{kind:"workflow"},{id:"not-a-uuid"},{id:id.toUpperCase()},{version:2},{workRevision:2},{title:"unbounded"}])expect(taskRegistrationResponse.safeParse({...body,data:{...body.data,...change}}).success).toBe(false);
});
it("accepts only a single supported preference grammar",()=>{
 for(const value of["return=minimal"," RETURN = minimal\t"])expect(taskCreationPreference(value)).toBe(true);
 for(const value of[null,"return=MINIMAL","return=Minimal","return=minimal-extra","return=minimal,return=minimal","return=minimal,return=representation","x=return=minimal","return=minimal; x=y"])expect(taskCreationPreference(value)).toBe(false);
});
