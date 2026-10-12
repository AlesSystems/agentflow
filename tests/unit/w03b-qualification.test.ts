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
