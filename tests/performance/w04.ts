import assert from "node:assert/strict";
import { lstatSync,mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { join,isAbsolute } from "node:path";
import { captureSourceBinding,fileSHA256,ownedDirectory,sha256,validateOutputRoot,verifySourceBinding,type SourceBinding } from "../fixtures/w04-qualification";
import { validatePrepared,validateResult,type CampaignResult } from "../fixtures/w04-campaign";
import { qualifiedService } from "../fixtures/w03a-qualification";
const counters={servicesStarted:0,serviceAttempts:0,sampleAttempts:0};
let intended:number|null=null;
const helpers=["tests/fixtures/server.ts","tests/fixtures/w01-runtime.ts","tests/fixtures/w03a-qualification.ts","tests/fixtures/w04-qualification.ts","tests/fixtures/w04-campaign.ts","tests/performance/w04.ts"];
function privateJSON(path:string){assert(isAbsolute(path));const s=lstatSync(path);assert(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid!()&&(s.mode&0o777)===0o600,"private regular input required");return JSON.parse(readFileSync(path,"utf8"));}
function options(args:string[]){
 assert.equal(args.length,10,"five option pairs required");const allowed=["--phase","--base-root","--head-root","--proof-dir","--runtime-root"],result:Record<string,string>={};
 for(let i=0;i<args.length;i+=2){assert(allowed.includes(args[i])&&!Object.hasOwn(result,args[i]),"unknown or duplicate option");result[args[i]]=args[i+1];}
 assert(["prepare","control","run"].includes(result["--phase"]),"unknown phase");for(const flag of allowed.slice(1))assert(result[flag]&&isAbsolute(result[flag]),"absolute root required");return result;
}
async function main(){
 const args=options(process.argv.slice(2)),phase=args["--phase"],proof=args["--proof-dir"],head=args["--head-root"],base=args["--base-root"],runtime=args["--runtime-root"];
 validateOutputRoot(proof);
 if(phase==="run"){
  assert(process.env.AGENTFLOW_W04_QUIET_RELEASE,"Root explicit quiet release required before services or samples");
  const release=privateJSON(process.env.AGENTFLOW_W04_QUIET_RELEASE);assert.equal(release.authority,"ROOT_EXPLICIT_W04_RELEASE");assert.equal(fileSHA256(release.preparedPath),release.preparedSHA256);
  const prepared=validatePrepared(privateJSON(release.preparedPath));intended=prepared.intended;
  assert.equal(release.helperSHA256,prepared.value.helperSHA256);assert.equal(release.helperSHA256,fileSHA256(import.meta.filename));
  assert(release.readinessSHA256&&release.byteAuditSHA256&&release.sqlAuditSHA256&&release.allIdleSHA256,"independent readiness, byte/SQL audit and all-idle originals required");
  throw new Error("Task4 finite workload orchestration/readiness is not implemented; no official run authorized by Task1");
 }
 assert.equal(process.cwd(),head,"controller executes in qualified current head");
 const browser=privateJSON(process.env.AGENTFLOW_W04_BROWSER_IDENTITY??"") as SourceBinding["browser"];
 const bindings={base:captureSourceBinding(base,runtime,browser,["tests/fixtures/server.ts"]),head:captureSourceBinding(head,runtime,browser,helpers)};
 const save=(name:string,value:unknown)=>writeFileSync(join(proof,name),JSON.stringify(value,null,2)+"\n",{mode:0o600,flag:"wx"});
 save("source-bindings.json",bindings);
 if(phase==="prepare"){
  save("preparation.json",{status:"TASK1_SOURCE_QUALIFIED_NOT_CAMPAIGN_READY",bindingsSHA256:fileSHA256(join(proof,"source-bindings.json")),helperSHA256:fileSHA256(import.meta.filename),setupLedger:[],operationTimingRows:[],officialWorkloadComplete:false,missingGates:["Task2 actual CLI/two-tab correctness","Task3 upgrade and stopped SQL","Task4 complete finite declarations/resources/readiness","Root independent audits/all-idle/quiet release"]});
  console.log(JSON.stringify({kind:"preparedSources",...counters,officialReady:false,operationTimingRows:0}));return;
 }
 const inputPath=process.env.AGENTFLOW_W04_CONTROL_INPUT;
 if(inputPath){
  const input=privateJSON(inputPath);intended=Array.isArray(input.prepared?.declarations)?input.prepared.declarations.length:null;
  verifySourceBinding(input.bindings.base,bindings.base);verifySourceBinding(input.bindings.head,bindings.head);
  if(input.prepared){const prepared=validatePrepared(input.prepared);intended=prepared.intended;assert.deepEqual(prepared.value.sources,{base:bindings.base.fingerprint,head:bindings.head.fingerprint});assert.deepEqual(prepared.value.builds,{base:sha256(JSON.stringify(bindings.base.compiled)),head:sha256(JSON.stringify(bindings.head.compiled))});assert.equal(prepared.value.runtimeSHA256,bindings.head.runtime.nodeSHA256);assert.equal(prepared.value.helperSHA256,fileSHA256(import.meta.filename));if(input.result)assert(validateResult(prepared.value,input.result as CampaignResult).acceptance,"result/correctness/resource/shutdown rejected");}
  save("control-result.json",{acceptance:true,intended,...counters,officialSamples:0});console.log(JSON.stringify({kind:"controlValidated",intended,...counters,officialSamples:0}));return;
 }
 const dir=join(proof,"service-fixture");mkdirSync(dir,{mode:0o700});ownedDirectory(dir,true);const services:unknown[]=[];let failure:unknown;
 try{
  counters.serviceAttempts++;await qualifiedService({cwd:head,dir,nodeExecutable:join(runtime,"bin/node")},services,async server=>{const response=await fetch(server.url+"/api/v1/health",{signal:AbortSignal.timeout(2000)});const text=await response.text();save("health-original.json",{status:response.status,text});assert.equal(response.status,200);});
 }catch(error){failure=error;}finally{counters.servicesStarted=services.filter(value=>(value as {pid:number|null}).pid!==null).length;save("service-originals.json",services);save("control-result.json",{acceptance:failure===undefined,intended,...counters,officialSamples:0,failure:failure===undefined?null:String(failure)});}
 if(failure!==undefined)throw failure;
 console.log(JSON.stringify({kind:"serviceSmoke",...counters,officialSamples:0}));
}
main().catch(error=>{console.log(JSON.stringify({kind:"preflightRejected",reason:String(error),intended,...counters}));process.exitCode=1;});
