import {expect,it} from "vitest";
import {validateFlush,type FlushFacts} from "../fixtures/p07-flush";
import {resourceBoundary} from "../fixtures/p07-resource-boundary";
it("refuses to finalize without the planned immutable queued events",()=>{
  expect(()=>validateFlush({queued:[],expected:{queued:4,tasks:12,events:20,producers:2,runs:[]},attempts:[],stdout:[],generation:null,database:null,pages:[],files:[]} as FlushFacts)).toThrow("QUEUED_COUNT");
});
it("freezes measurement end before delayed failing cleanup and attempts remaining cleanup",async()=>{
  const result={endedMs:null as number|null};let atCleanup:number|null=null,next=false;
  await expect(resourceBoundary(result,async()=>{},[["delay",async()=>{atCleanup=result.endedMs;await new Promise(resolve=>setTimeout(resolve,20));throw new Error("fixture cleanup failure");}],["remaining",async()=>{next=true;}]],()=>{})).rejects.toThrow();
  expect(atCleanup).toBeTypeOf("number");expect(result.endedMs).toBe(atCleanup);expect(next).toBe(true);
});

it("retains measurement failure separately from cleanup failure",async()=>{
  const result={status:"unfinalized",endedMs:null as number|null,failure:null as string|null,cleanup:undefined as import("../fixtures/p07-resource-boundary").ResourceInterval["cleanup"]};let ended:number|null=null;
  await expect(resourceBoundary(result,async()=>{throw new Error("measure fixture failure");},[["failed cleanup",async()=>{ended=result.endedMs;throw new Error("cleanup fixture failure");}]],()=>{})).rejects.toThrow("measure fixture failure");
  expect(result.status).toBe("unfinalized");expect(result.failure).toBe("measure fixture failure");expect(result.endedMs).toBe(ended);expect(result.cleanup?.failures).toEqual([{action:"failed cleanup",error:"cleanup fixture failure"}]);
});
