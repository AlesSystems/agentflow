import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync,readFileSync,readdirSync,writeFileSync,readlinkSync } from "node:fs";
import { join } from "node:path";
import { historyLine,historyManifest,historyComplete } from "../../src/contracts/history";
import { distribution } from "./p07-protocol";
import { reconcile,type CaptureSample } from "./w03a-qualification";
export function validateExport(text:string){
 assert(text.endsWith("\n"),"truncated JSONL");
 const records=text.slice(0,-1).split("\n").map(line=>historyLine.parse(JSON.parse(line)));
 const manifest=historyManifest.parse(records[0]),complete=historyComplete.parse(records.at(-1));
 const actual=Object.fromEntries(Object.keys(manifest.counts).map(kind=>[kind,records.slice(1,-1).filter(row=>row.kind===kind).length]));
 assert.equal(records.slice(1,-1).length,Object.values(actual).reduce((a,b)=>a+b,0),"unexpected records");
 assert.deepEqual(actual,manifest.counts,"export counts mismatch");assert.deepEqual(complete.counts,manifest.counts,"completion counts mismatch");
 return {generation:manifest.generation,counts:actual,bytes:Buffer.byteLength(text),records:records.length};
}
export function verifyPins(expected:unknown,actual:unknown){assert.deepEqual(actual,expected,"frozen source/build changed");}
export function physicalPins(root:string){
 const source:Record<string,string>={},build:Record<string,string>={};
 const walk=(dir:string,prefix:string,target:Record<string,string>)=>{for(const name of readdirSync(dir).sort()){if(["node_modules",".git",".superpowers"].includes(name))continue;const path=join(dir,name),key=prefix+name,stat=lstatSync(path);if(stat.isDirectory())walk(path,key+"/",target);else if(stat.isFile())target[key]=createHash("sha256").update(readFileSync(path)).digest("hex");}};
 for(const name of readdirSync(root).sort()){if(["node_modules",".git",".superpowers"].includes(name))continue;const path=join(root,name),stat=lstatSync(path);if(name===".next"){walk(path,"",build);continue;}if(stat.isDirectory())walk(path,name+"/",source);else if(stat.isFile())source[name]=createHash("sha256").update(readFileSync(path)).digest("hex");}
 return {source,build,node:process.execPath,nodeSHA256:createHash("sha256").update(readFileSync(process.execPath)).digest("hex")};
}
export async function qualifyRequests(declarations:{id:string;warmup:boolean}[],work:(id:string)=>Promise<Omit<CaptureSample,"id"|"warmup"|"confirmed"|"failure">>,save:(row:CaptureSample)=>void=()=>{}){
 const samples:CaptureSample[]=[];let primary:string|null=null;
 for(const declaration of declarations){const row:CaptureSample={...declaration,status:null,elapsedMs:null,failure:null,confirmed:false,text:null,generation:null,dispatchMs:performance.now(),drainedMs:null};samples.push(row);
  try{Object.assign(row,await work(row.id));row.confirmed=true;}catch(error){row.failure=String(error);primary=String(error);}finally{row.drainedMs??=performance.now();row.elapsedMs??=row.drainedMs-row.dispatchMs;save(row);}if(primary!==null)break;
 }
 const result=reconcile(declarations,samples,primary,[]);return {...result,acceptance:result.valid,samples};
}
export function validateRecovery(observation:{priorGeneration:string;generation:string;resetText:string;originalReceipt:unknown;retryReceipt:unknown;retryGeneration:string}){
 assert.notEqual(observation.generation,observation.priorGeneration,"generation did not renew");
 assert.match(observation.resetText,/event: reset\n/,"missing visible reset");
 assert(observation.resetText.includes(observation.generation),"reset generation mismatch");
 assert.deepEqual(observation.retryReceipt,observation.originalReceipt,"lost original receipt");
 assert.equal(observation.retryGeneration,observation.generation,"retry response current generation mismatch");
}

export function retainControl(name:string,observations:unknown){const root=process.env.AGENTFLOW_W03B_CONTROL_PROOF_DIR;if(root){assert.equal(lstatSync(root).mode&0o777,0o700);writeFileSync(join(root,name.replaceAll(" ","-")+".json"),JSON.stringify(observations,null,2)+"\n",{mode:0o600,flag:"wx"});}}

export function runtimePins(root:string){
 const files:Record<string,{sha256?:string;link?:string;dev:number;ino:number;uid:number;mode:number;size:number}>={};
 const walk=(dir:string,prefix="")=>{for(const name of readdirSync(dir).sort()){const path=join(dir,name),key=prefix+name,stat=lstatSync(path);files[key]={dev:stat.dev,ino:stat.ino,uid:stat.uid,mode:stat.mode&0o777,size:stat.size,...(stat.isFile()?{sha256:createHash("sha256").update(readFileSync(path)).digest("hex")}:stat.isSymbolicLink()?{link:readlinkSync(path)}:{})};if(stat.isDirectory())walk(path,key+"/");}};
 walk(root);const stat=lstatSync(root);return {root,identity:{dev:stat.dev,ino:stat.ino,uid:stat.uid,mode:stat.mode&0o777},files};
}

export function bindTimings(records:Record<string,unknown>[],requests:Record<string,unknown>[],outputPath:string):Record<string,unknown>[]{
 const exports=requests.filter(row=>String(row.path).startsWith("/api/v1/export")),previews=requests.filter(row=>String(row.path).endsWith("/retention/preview")),prunes=requests.filter(row=>String(row.path).endsWith("/retention/prune"));
 const timings=records.filter(row=>String(row.kind).endsWith("Timing"));
 const expected={exportPreparationTiming:exports.length,previewTransactionTiming:previews.length,transactionTiming:prunes.length,backupTiming:exports.length+prunes.length};
 for(const [kind,count] of Object.entries(expected))assert.equal(timings.filter(row=>row.kind===kind).length,count,"missing or mismatched timing cardinality "+kind);
 for(let ordinal=1;ordinal<=exports.length;ordinal++){
  assert.equal(timings.filter(row=>row.kind==="exportPreparationTiming"&&row.ordinal===ordinal).length,1,"missing export preparation identity");
  const batches=timings.filter(row=>row.kind==="exportBatchTiming"&&row.ordinal===ordinal);assert(batches.length,"missing export batch stream");
  assert.deepEqual(batches.map(row=>row.batch),batches.map((_,i)=>i+1),"mismatched batch cardinality");assert.equal(batches.at(-1)!.rows,0,"missing terminal batch");assert(batches.every((row,i)=>Number.isInteger(row.rows)&&Number(row.rows)>=0&&Number(row.rows)<=100&&(i===batches.length-1||Number(row.rows)>0)),"invalid batch rows");
 }
 return timings.map(row=>{
  assert(Object.hasOwn(expected,String(row.kind))||row.kind==="exportBatchTiming","unknown timing kind");
  const ms=Number(row.kind==="exportPreparationTiming"?row.residualMs:row.ms);assert(Number.isFinite(ms)&&ms>=0,"invalid timing value");
  const request=row.key?requests.find(request=>request.key===row.key):row.ordinal?exports[Number(row.ordinal)-1]:row.kind==="backupTiming"?prunes[0]??exports[timings.filter(record=>record.kind==="exportPreparationTiming").findIndex(record=>record.destination===row.destination)]:undefined;
  assert(request,"timing missing original request identity");return {...row,requestId:request!.id,serviceOutputPath:outputPath};
 });
}

export function reduceTimings(_declarations:{id:string;warmup:boolean}[],serviceMetrics:{fixtureId:string;records:Record<string,unknown>[]}[]){
 const summaries=Array.from({length:3},(_,i)=>{const round=i+1;return ["previewTransactionTiming","exportPreparationTiming","exportBatchTiming","transactionTiming","backupTiming"].map(kind=>{const rows=serviceMetrics.filter(group=>group.fixtureId.startsWith(`preview-${round}`)||group.fixtureId.startsWith(`export-${round}`)||group.fixtureId.startsWith(`prune-${round}-`)).flatMap(group=>group.records).filter(row=>row.kind===kind);return {round,kind,cohort:"pooled",observed:rows.length,distribution:rows.length?distribution(rows.map(row=>Number(kind==="exportPreparationTiming"?row.residualMs:row.ms))):null};});}).flat();
 const budgetFailures=summaries.filter(row=>["previewTransactionTiming","exportPreparationTiming","exportBatchTiming"].includes(row.kind)&&row.distribution&&row.distribution.p95Ms>=250);
 return {summaries,budgetFailures,acceptance:!budgetFailures.length};
}
