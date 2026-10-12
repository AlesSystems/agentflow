import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect,it } from "vitest";
import { validateOutputRoot } from "../fixtures/w04-qualification";
const root=()=>mkdtempSync(join(process.env.TMPDIR??tmpdir(),"w04-qualification-"));
it("requires a real private unused output directory",()=>{const p=root();expect(validateOutputRoot(p)).toMatchObject({mode:448,uid:process.getuid!()});writeFileSync(join(p,"existing"),"held");expect(()=>validateOutputRoot(p)).toThrow(/unused/);});
it("rejects files, symlinks, and wrong modes before writing",()=>{const p=root(),file=join(p,"file"),link=join(p,"link"),publicDir=join(p,"public");writeFileSync(file,"held");symlinkSync(p,link);mkdirSync(publicDir);chmodSync(publicDir,0o755);for(const path of [file,link,publicDir])expect(()=>validateOutputRoot(path)).toThrow();expect(readFileSync(file,"utf8")).toBe("held");});
for(const phase of ["unknown","run"] as const)it(`actual controller rejects ${phase} before any service or sample attempt`,()=>{
 const proof=root();const child=spawnSync(process.execPath,["--import","tsx","tests/performance/w04.ts","--phase",phase,"--base-root",process.cwd(),"--head-root",process.cwd(),"--proof-dir",proof,"--runtime-root",join(process.execPath,"../..")],{cwd:process.cwd(),env:{...process.env,AGENTFLOW_W04_QUIET_RELEASE:""},encoding:"utf8"});
 expect(child.status).toBe(1);const row=JSON.parse(child.stdout.trim());expect(row).toMatchObject({kind:"preflightRejected",servicesStarted:0,sampleAttempts:0});expect(row.reason).toMatch(phase==="unknown"?/phase/:/Root.*release/);
});

import { beforeAll } from "vitest";
import { fileSHA256,sha256,type SourceBinding } from "../fixtures/w04-qualification";
import type { PreparedCampaign,CampaignResult } from "../fixtures/w04-campaign";
let bindings:{base:SourceBinding;head:SourceBinding};
function invoke(phase:string,proof:string,input?:string){
 const base=process.env.AGENTFLOW_W04_BASE_SOURCE,runtime=process.env.AGENTFLOW_W04_RUNTIME_ROOT;expect(base,"qualified Phase2 source required").toBeTypeOf("string");expect(runtime,"owned runtime required").toBeTypeOf("string");
 const child=spawnSync(process.execPath,["--import","tsx","tests/performance/w04.ts","--phase",phase,"--base-root",base!,"--head-root",process.cwd(),"--proof-dir",proof,"--runtime-root",runtime!],{cwd:process.cwd(),env:{...process.env,AGENTFLOW_W04_CONTROL_INPUT:input??""},encoding:"utf8",timeout:30000});
 const parent=join(proof,"..");writeFileSync(join(parent,proof.split("/").at(-1)+"-original.json"),JSON.stringify({argv:child.spawnargs,status:child.status,signal:child.signal,stdout:child.stdout,stderr:child.stderr,error:child.error?String(child.error):null}),{mode:0o600,flag:"wx"});return child;
}
beforeAll(()=>{const proof=root(),child=invoke("prepare",proof);expect(child.status,child.stderr).toBe(0);expect(JSON.parse(child.stdout.trim())).toMatchObject({kind:"preparedSources",servicesStarted:0,serviceAttempts:0,sampleAttempts:0,officialReady:false,operationTimingRows:0});bindings=JSON.parse(readFileSync(join(proof,"source-bindings.json"),"utf8"));expect(bindings.base.commit).toBe("dd26c4b00867e7680c3baf0cf2be39b60502aecf");});
function controlInput(){
 const generation="11111111-1111-4111-8111-111111111111",h="a".repeat(64);
 const prepared:PreparedCampaign={version:1,scope:"task1-qualification",sources:{base:bindings.base.fingerprint,head:bindings.head.fingerprint},helperSHA256:fileSHA256(join(process.cwd(),"tests/performance/w04.ts")),runtimeSHA256:bindings.head.runtime.nodeSHA256,builds:{base:sha256(JSON.stringify(bindings.base.compiled)),head:sha256(JSON.stringify(bindings.head.compiled))},intendedIds:["sample-1"],declarations:[{id:"sample-1",source:"head",operation:"tasks",endpoint:"/api/v1/tasks",repetition:1,fixture:"fixture-1",warmup:false}],fixtures:[{id:"fixture-1",source:"head",sha256:h,schema:12,generation,cursor:"0"}],requiredResources:{service:["requests","sockets"],browser:["eventSources","timers"]},correctness:{cli:{originalSHA256:h,exitCode:0,declared:["event-1"],acks:["event-1"]},tabs:[{id:"graph",originalSHA256:h,generation},{id:"list",originalSHA256:h,generation}]},officialWorkloadComplete:false};
 const result:CampaignResult={samples:[{id:"sample-1",accepted:true,failure:null}],resources:{service:{requests:0,sockets:0},browser:{eventSources:0,timers:0}},shutdown:{closed:true,stdioClosed:true,exitCode:0,signalCode:null}};
 return {bindings:structuredClone(bindings),prepared,result};
}
it("accepts a separate synthetic guard fixture with zero official timings",()=>{const input=controlInput(),p=root(),inputPath=join(p,"input.json");writeFileSync(inputPath,JSON.stringify(input),{mode:0o600});const child=invoke("control",root(),inputPath);expect(child.status,child.stderr).toBe(0);expect(JSON.parse(child.stdout.trim())).toMatchObject({kind:"controlValidated",intended:1,servicesStarted:0,serviceAttempts:0,sampleAttempts:0,officialSamples:0});});
for(const defect of ["source","build","runtime","helper","missing ID","duplicate ID","CLI","two tabs","resource keys","shutdown"] as const)it(`actual controller rejects ${defect} and retains its frozen intended denominator`,()=>{
 const input=controlInput();
 if(defect==="source")input.bindings.head.packageSHA256="f".repeat(64);
 else if(defect==="build")input.bindings.head.compiled.buildId="wrong-build";
 else if(defect==="runtime")input.bindings.head.runtime.nodeSHA256="f".repeat(64);
 else if(defect==="helper")input.bindings.head.helpers["tests/performance/w04.ts"]="f".repeat(64);
 else if(defect==="missing ID")input.prepared.declarations=[];
 else if(defect==="duplicate ID")input.prepared.declarations.push({...input.prepared.declarations[0]});
 else if(defect==="CLI")input.prepared.correctness.cli.acks=[];
 else if(defect==="two tabs")input.prepared.correctness.tabs.pop();
 else if(defect==="resource keys")input.result.resources.browser={};
 else input.result.shutdown.exitCode=1;
 const p=root(),path=join(p,"input.json");writeFileSync(path,JSON.stringify(input),{mode:0o600});const child=invoke("control",root(),path);expect(child.status).toBe(1);expect(JSON.parse(child.stdout.trim())).toMatchObject({kind:"preflightRejected",intended:1,servicesStarted:0,serviceAttempts:0,sampleAttempts:0});
});
