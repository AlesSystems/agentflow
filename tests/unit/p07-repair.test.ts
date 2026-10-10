import {expect,it} from "vitest";
import {validateFlush} from "../fixtures/p07-flush";
import {resourceBoundary} from "../fixtures/p07-resource-boundary";
it("refuses to finalize without the planned immutable queued events",()=>{
  expect(()=>validateFlush({queued:[],expected:{queued:4}})).toThrow("QUEUED_COUNT");
});
it("freezes measurement end before delayed failing cleanup and attempts remaining cleanup",async()=>{
  const result={endedMs:null as number|null};let atCleanup:number|null=null,next=false;
  await expect(resourceBoundary(result,async()=>{},[["delay",async()=>{atCleanup=result.endedMs;await new Promise(resolve=>setTimeout(resolve,20));throw new Error("fixture cleanup failure");}],["remaining",async()=>{next=true;}]],()=>{})).rejects.toThrow();
  expect(atCleanup).toBeTypeOf("number");expect(result.endedMs).toBe(atCleanup);expect(next).toBe(true);
});
