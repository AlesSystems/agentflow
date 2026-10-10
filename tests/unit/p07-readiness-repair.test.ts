import {it,expect} from "vitest";
import {flushBoundary} from "../fixtures/p07-flush-boundary";
import {resourceBoundary} from "../fixtures/p07-resource-boundary";
import {validateFlush,type FlushFacts} from "../fixtures/p07-flush";
import {canonicalDigest} from "../../src/domain/request-digest";
import {createHash} from "node:crypto";
it.each(["flush","resource"])("actual %s boundary preserves primary and remaining cleanup when pre/post saves fail",async kind=>{
 const primary=new Error("first measurement error"),io=new Error("injected save ENOSPC");let first=0,second=0;
 const result={measuredStartedMs:0,measuredEndedMs:null as number|null,elapsedMs:null as number|null,endedMs:null as number|null,failure:"",reconciliationStatus:"unfinalized",reconciliation:null,status:"unfinalized"};
 const work=async()=>{throw primary;},cleanup:[string,()=>Promise<void>][]=[["first",async()=>{first++;}],["second",async()=>{second++;}]],save=()=>{throw io;};
 await expect(kind==="flush"?flushBoundary(result,work,cleanup,save):resourceBoundary(result,work,cleanup,save)).rejects.toBe(primary);expect([first,second]).toEqual([1,1]);
});
it.each([undefined,null,false,0])("actual flush/resource boundaries propagate falsy first thrown value %s",async primary=>{
 const result={measuredStartedMs:null,measuredEndedMs:null,elapsedMs:null,failure:"",reconciliationStatus:"unfinalized",reconciliation:null};
 const outcome=await flushBoundary(result,async()=>{throw primary;},[],()=>{}).then(()=>({failed:false,value:null}),value=>({failed:true,value}));expect(outcome).toEqual({failed:true,value:primary});expect(result.measuredEndedMs).toBeNull();
 const resource={status:"unfinalized",startedMs:null,endedMs:null,failure:null as string|null};const observed=await resourceBoundary(resource,async()=>{throw primary;},[],()=>{}).then(()=>({failed:false,value:null}),value=>({failed:true,value}));expect(observed).toEqual({failed:true,value:primary});expect(resource.endedMs).toBeNull();
});
it("actual flush validator rejects stored cursor-only anomaly without changing stdout fields",()=>{
 const runId="00000000-0000-4000-8000-000000000001",eventId="00000000-0000-4000-8000-000000000002",generation="00000000-0000-4000-8000-000000000003",time="2026-10-10T00:00:00.000Z";
 const body={schemaVersion:1,eventId,runId,sequence:1,type:"run.started",occurredAt:time,payload:{}},digest=canonicalDigest(body),bytes=Buffer.from(JSON.stringify({body,digest})),event={...body,receivedAt:time},receipt={data:{eventId,runId,acceptedSequence:1,receivedAt:time},snapshotCursor:"64",generation};
 const facts:FlushFacts={expected:{tasks:1,events:0,producers:1,queued:1,runs:[runId]},queued:[{body,digest,bytes:bytes.length,fileSha256:createHash("sha256").update(bytes).digest("hex"),filename:`${runId}/1-${eventId}.json`,originalBytesBase64:bytes.toString("base64")}],attempts:[{requestBytesBase64:Buffer.from(JSON.stringify(body)).toString("base64"),responseBytesBase64:Buffer.from(JSON.stringify(receipt)).toString("base64"),status:201,generation}],stdout:[JSON.stringify({...receipt.data,generation})],generation,database:{rows:[{event_id:eventId,run_id:runId,sequence:1,body:JSON.stringify(event),digest,acknowledgement:JSON.stringify(receipt),received_at:Date.parse(time),occurred_at:Date.parse(time)}],counts:{tasks:1,agents:1,runs:2,run_events:1},integrity:[{integrity_check:"ok"}],foreignKeys:[]},pages:[{status:200,raw:JSON.stringify({data:{items:[event],total:1,nextCursor:null},snapshotCursor:"64",generation}),generation}],files:[{path:"metadata.json",bytesBase64:Buffer.from(JSON.stringify({generation})).toString("base64")},{path:runId+"/state.json",bytesBase64:Buffer.from(JSON.stringify({formatVersion:1,runId,generation,allocatedThrough:1,acknowledgedThrough:1})).toString("base64")}]};
 expect(validateFlush(facts).uniqueEvents).toBe(1);facts.database!.rows![0].acknowledgement=JSON.stringify({...receipt,snapshotCursor:"999"});expect(()=>validateFlush(facts)).toThrow();
});

it.each(["flush","resource"])("actual %s write-only/transient faults fail after eventual persistence and all cleanup",async kind=>{
 const io=new Error("one-time save error"),result={measuredStartedMs:1,measuredEndedMs:null as number|null,elapsedMs:null as number|null,endedMs:null as number|null,failure:"",reconciliationStatus:"finalized",reconciliation:{status:"finalized"},status:"finalized"};let writes=0,first=0,second=0,end:number|null=null;
 const cleanup:[string,()=>Promise<void>][]=[["first",async()=>{first++;end=kind==="flush"?result.measuredEndedMs:result.endedMs;}],["second",async()=>{second++;}]],save=()=>{if(++writes===1)throw io;};
 await expect(kind==="flush"?flushBoundary(result,async()=>{},cleanup,save):resourceBoundary(result,async()=>{},cleanup,save)).rejects.toBe(io);expect([first,second,writes]).toEqual([1,1,2]);expect(kind==="flush"?result.measuredEndedMs:result.endedMs).toBe(end);expect(result.failure).toBe(io.message);
});
