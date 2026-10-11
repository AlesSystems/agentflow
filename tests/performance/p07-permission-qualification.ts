import assert from "node:assert/strict";
import {mkdirSync,copyFileSync,writeFileSync,existsSync} from "node:fs";
import {join} from "node:path";
import Database from "better-sqlite3";
import {privateCopy,registerCopy} from "../fixtures/p07-copy-permissions";
import {launch} from "../fixtures/server";
import {flushBoundary} from "../fixtures/p07-flush-boundary";
const root=process.env.AGENTFLOW_P07_QUALIFICATION_ROOT!,source=process.env.AGENTFLOW_P07_DIAGNOSTIC_SOURCE!;
assert(root&&source);assert(!existsSync(root),"QUALIFICATION_NAMESPACE_ALREADY_USED");mkdirSync(root,{mode:0o700});
const dir=join(root,"copy");mkdirSync(dir,{mode:0o700});
const sourceDB=new Database(join(source,"load-0/agentflow.sqlite"),{readonly:true});try{await sourceDB.backup(join(dir,"agentflow.sqlite"));}finally{sourceDB.close();}copyFileSync(join(source,"load-0/credentials.json"),join(dir,"credentials.json"));
const expected=registerCopy(dir);const db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});let counts:unknown;try{counts=db.prepare("SELECT count(*) events FROM run_events").get();}finally{db.close();}
const before=privateCopy(dir,expected,true);
const result={startupAllowed:1,startupAttempts:0,counts,before,after:null as unknown,health:null as unknown,measuredStartedMs:null,measuredEndedMs:null,elapsedMs:null,failure:"",reconciliationStatus:"unfinalized",reconciliation:null as unknown,qualification:"ordinary unprofiled bootstrap/health only; no events/browser/profile/load"};
const save=()=>writeFileSync(join(root,"qualification.json"),JSON.stringify(result,null,2)+"\n",{mode:0o600});save();
let server:Awaited<ReturnType<typeof launch>>|undefined;
try{await flushBoundary(result,async()=>{privateCopy(dir,expected);result.startupAttempts++;save();server=await launch({dir});const response=await fetch(server.url+"/api/v1/health");result.health={status:response.status,raw:await response.text()};assert.equal(response.status,200);result.reconciliationStatus="qualified";},[
 ["stop ordinary runtime",async()=>{await server?.stop();}],
 ["capture logs",async()=>{if(server)writeFileSync(join(root,"server.log"),server.logs(),{mode:0o600});}],
 ["post-stop filesystem check",async()=>{result.after=privateCopy(dir,expected);}]
],save);}catch(error){console.error(error);process.exitCode=1;}
