import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,existsSync,writeFileSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {loadScenario,type LoadHooks} from "../fixtures/p07-load";
import {privateCopy,registerCopy} from "../fixtures/p07-copy-permissions";
import {profile} from "../fixtures/p07-diagnostic-profile";
const root=process.env.AGENTFLOW_P07_WARM_ROOT!,expectedHead=process.env.AGENTFLOW_P07_EXPECTED_HEAD!;
assert(root&&expectedHead,"EXPLICIT_ROOT_AND_SOURCE_REQUIRED");
assert.equal(execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),expectedHead,"SOURCE_SHA_MISMATCH");
assert.equal(execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim(),"","SOURCE_NOT_CLEAN");
assert(!existsSync(root),"WARM_NAMESPACE_ALREADY_USED");mkdirSync(root,{mode:0o700});
const provenance={expectedHead,cwd:process.cwd(),node:process.version,buildId:readFileSync(".next/BUILD_ID","utf8").trim(),scope:"controller and service across300s sustained+10s burst, no forcedGC",allowed:1,used:1,classification:"diagnostic; original failed campaign remains failed"};
writeFileSync(join(root,"attempt.json"),JSON.stringify(provenance,null,2)+"\n",{mode:0o600,flag:"wx"});
let finish:(()=>Promise<unknown>)|undefined;
const facts={controllerStart:null as unknown,controllerEnd:null as unknown,serverStart:null as unknown,serverEnd:null as unknown,permissions:null as unknown,phaseMarkers:[] as unknown[],artifacts:{} as Record<string,{cpu:boolean;partial:boolean}>,instrumentation:"inspector sampling;GC entries;100ms loop/runtime/stream snapshots retained across both phases; additional profiler objects affect heap and overhead; clocks are diagnostic only"};
const artifact=(name:string)=>facts.artifacts[name]={cpu:existsSync(join(root,name+"-profile.json")),partial:existsSync(join(root,name+"-profile.json.partial.json"))};
let activeServer:Parameters<NonNullable<LoadHooks["start"]>>[0]|undefined;
async function marker(action:string){assert(activeServer);const requestedMs=performance.now();activeServer.child.stdin!.write(JSON.stringify({action,path:join(root,"server-profile.json")})+"\n");for(;;){const line=activeServer.logs().split("\n").find(line=>line.startsWith("DIAGNOSTIC ")&&JSON.parse(line.slice(11)).action===action);if(line)return {requestedMs,confirmedMs:performance.now(),server:JSON.parse(line.slice(11))};assert(performance.now()-requestedMs<10000,"PROFILE_MARKER_TIMEOUT");await new Promise(resolve=>setTimeout(resolve,10));}}
const hooks:LoadHooks={
 launchOptions:{entry:"tests/fixtures/p07-diagnostic-runtime.ts",stdin:true},facts,
 beforeLaunch:dir=>{const expected=registerCopy(dir);facts.permissions=privateCopy(dir,expected,true);privateCopy(dir,expected);},
 start:async server=>{activeServer=server;facts.serverStart=await marker("start");const requestedMs=performance.now();finish=await profile(join(root,"controller-profile.json"));facts.controllerStart={requestedMs,confirmedMs:performance.now(),wallMs:Date.now(),memory:process.memoryUsage()};console.log("WARM profiles ready before sustained");},
 phase:phase=>{const anchor={phase,ms:performance.now(),wallMs:Date.now(),memory:process.memoryUsage()};facts.phaseMarkers.push(anchor);activeServer!.child.stdin!.write(JSON.stringify({action:"phase",phase})+"\n");console.log("WARM phase "+phase);},
 cleanup:server=>[
  ["controller profile",async()=>{try{if(finish)facts.controllerEnd=await finish();}finally{artifact("controller");}}],
  ["server profile",async()=>{try{if(server)facts.serverEnd=await marker("end");}finally{artifact("server");}}],
  ["retain server phase/log facts",async()=>{if(server)writeFileSync(join(root,"server.log"),server.logs(),{mode:0o600});}]
 ]
};
try{await loadScenario(root,0,true,hooks);console.log("WARM diagnostic completed; not acceptance");}catch(error){writeFileSync(join(root,"first-error.txt"),String(error)+"\n",{mode:0o600});console.error(error);process.exitCode=1;}
