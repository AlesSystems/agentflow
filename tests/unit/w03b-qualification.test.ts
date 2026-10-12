import { expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync,writeFileSync,mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateExport, qualifyRequests, verifyPins,physicalPins,retainControl } from "../fixtures/w03b-qualification";
import { readBoundedText,deadline } from "../fixtures/w01-runtime";
const generation=randomUUID();
const complete=JSON.stringify({kind:"manifest",schemaVersion:1,generation,snapshotCursor:"0",createdAt:"2026-10-12T00:00:00.000Z",content:["attempts"],counts:{run:0,runEvent:0}})+"\n"+JSON.stringify({kind:"complete",schemaVersion:1,counts:{run:0,runEvent:0}})+"\n";
const valid=()=>({status:200,generation,text:JSON.stringify({generation}),elapsedMs:1,dispatchMs:0,drainedMs:1});
const controls:{name:string;run:()=>Promise<unknown>}[]=[
 {name:"aborted output",run:()=>readBoundedText(new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(complete.slice(0,40)));controller.error(new DOMException("aborted","AbortError"));}})))},
 {name:"truncated JSONL",run:async()=>validateExport(complete.slice(0,-2))},
 {name:"mismatched counts",run:async()=>validateExport(complete.replace('"run":0','"run":1'))},
 {name:"missing completion",run:async()=>validateExport(complete.split("\n")[0]+"\n")},
 {name:"deadline",run:()=>deadline(new Promise(()=>{}),1,"CONTROL_DEADLINE")},
 {name:"missing stream",run:async()=>validateExport(await readBoundedText(new Response(null)))},
 ...["source","build"].map(kind=>({name:`wrong ${kind}`,run:async()=>{const root=mkdtempSync(join(tmpdir(),"w03b-pin-control-"));mkdirSync(join(root,".next"));writeFileSync(join(root,"source.ts"),"first");writeFileSync(join(root,".next","BUILD_ID"),"first");const frozen=physicalPins(root);writeFileSync(kind==="source"?join(root,"source.ts"):join(root,".next","BUILD_ID"),"changed");verifyPins(frozen,physicalPins(root));}})),
];
it("accepts completed selected exports with literal matching counts",async()=>{
 expect(validateExport(complete).counts).toEqual({run:0,runEvent:0});
 const result=await qualifyRequests([{id:"first",warmup:false},{id:"second",warmup:false}],async()=>valid());expect(result.acceptance).toBe(true);expect(result.expected).toBe(2);expect(result.attempted).toBe(2);expect(result.failed).toEqual([]);
});
for(const control of controls)it(`invalidates actual ${control.name} capture retaining complete denominator`,async()=>{
 const result=await qualifyRequests([{id:"first",warmup:false},{id:"second",warmup:false}],async()=>{await control.run();return valid();});
 retainControl(control.name,{control:control.name,...result});expect(result.acceptance).toBe(false);expect(result.expected).toBe(2);expect(result.attempted).toBe(1);expect(result.missing).toEqual(["second"]);expect(result.failed).toEqual(["first"]);expect(result.samples[0].failure).toEqual(expect.any(String));
});

import { reduceTimings } from "../fixtures/w03b-qualification";
import { distribution } from "../fixtures/p07-protocol";
it("rejects one slow measured preview that fast warmups and JIT previews would hide",()=>{
 const declarations:{id:string;warmup:boolean}[]=[],metrics:{fixtureId:string;records:Record<string,unknown>[]}[]=[];
 for(let round=1;round<=3;round++){
  const preview:Record<string,unknown>[]=[];
  for(let index=0;index<20;index++){const id=`preview-${round}-${index}`;declarations.push({id,warmup:index<10});preview.push({kind:"previewTransactionTiming",requestId:id,ms:round===1&&index===10?300:1});}
  metrics.push({fixtureId:`preview-${round}`,records:preview});
  for(let index=0;index<10;index++){const id=`prune-preview-${round}-${index}`;declarations.push({id,warmup:false});metrics.push({fixtureId:`prune-${round}-${index+1}`,records:[{kind:"previewTransactionTiming",requestId:id,ms:1}]});}
 }
 expect(distribution(metrics.filter(group=>group.fixtureId.startsWith("preview-1")||group.fixtureId.startsWith("prune-1-")).flatMap(group=>group.records).map(row=>Number(row.ms))).p95Ms).toBe(1);
 const result=reduceTimings(declarations,metrics);
 expect(result.acceptance).toBe(false);
 expect(result.budgetFailures).toContainEqual(expect.objectContaining({round:1,kind:"previewTransactionTiming",cohort:"measured-preview",observed:10,distribution:expect.objectContaining({p95Ms:300})}));
 expect(result.summaries.filter(row=>row.kind==="previewTransactionTiming"&&row.round===1).map(row=>({cohort:row.cohort,count:row.observed}))).toEqual([{cohort:"measured-preview",count:10},{cohort:"jit-preview",count:10},{cohort:"warmup-preview",count:10}]);
 expect(result.expectedPreviewRequests).toBe(90);expect(result.observedPreviewTimings).toBe(90);expect(result.rawPreviewTimings).toHaveLength(90);
 const fast=structuredClone(metrics);fast[0].records[10].ms=1;
 const warmSlow=structuredClone(fast);warmSlow[0].records[0].ms=300;expect(reduceTimings(declarations,warmSlow).acceptance).toBe(true);
 const jitSlow=structuredClone(fast);jitSlow[1].records[0].ms=300;expect(reduceTimings(declarations,jitSlow).budgetFailures).toContainEqual(expect.objectContaining({round:1,cohort:"jit-preview",distribution:expect.objectContaining({p95Ms:300})}));
 for(const defect of ["absent ID","wrong warmup"]){const broken=structuredClone(metrics),declared=structuredClone(declarations);if(defect==="absent ID")broken[0].records[10].requestId="absent";else declared.find(row=>row.id==="prune-preview-1-0")!.warmup=true;const invalid=reduceTimings(declared,broken);expect(invalid.acceptance).toBe(false);expect(invalid.classificationFailures.length).toBeGreaterThan(0);expect(invalid.expectedPreviewRequests).toBe(90);expect(invalid.observedPreviewTimings).toBe(90);expect(invalid.rawPreviewTimings).toHaveLength(90);retainControl("preview-cohort-"+defect,{declarations:declared,metrics:broken,result:invalid});}
 retainControl("preview-timing-cohort",{declarations,metrics,result});
});
it("decodes explicitly selected historical v1 and current v2 exports without mixed versions",()=>{
 const head=complete.replaceAll('"schemaVersion":1','"schemaVersion":2').replaceAll('"runEvent":0','"runEvent":0,"usageMeasurement":0,"usagePriceSnapshot":0');
 expect(validateExport(head,2).counts).toEqual({run:0,runEvent:0,usageMeasurement:0,usagePriceSnapshot:0});
 expect(()=>validateExport(head,1)).toThrow();expect(()=>validateExport(complete,2)).toThrow();expect(()=>validateExport(head.replace('"kind":"complete","schemaVersion":2','"kind":"complete","schemaVersion":1'),2)).toThrow();
});
