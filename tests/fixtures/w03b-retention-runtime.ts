import assert from "node:assert/strict";
import { mkdtempSync,realpathSync,readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { startRuntime } from "../../src/server/launcher";
import { readConfig } from "../../src/server/config";
import { freePort } from "./server";
const dir=mkdtempSync(join(realpathSync(tmpdir()),"w03b-cancellation-")),port=await freePort();
const running=await startRuntime(readConfig({...process.env,AGENTFLOW_DATA_DIR:dir,PORT:String(port)},"production"));
try {
const url=`http://127.0.0.1:${port}`;
const session=await fetch(url+"/api/v1/session",{method:"POST",headers:{Origin:url,"Content-Type":"application/json"},body:JSON.stringify({token:running.owned.credentials.pairingToken})});assert.equal(session.status,200);const cookie=session.headers.get("set-cookie")!.split(";")[0];
const headers={Cookie:cookie,Origin:url,"Content-Type":"application/json"};
const call=async(path:string,input:unknown,signal?:AbortSignal)=>fetch(url+"/api/v1/retention/"+path,{method:"POST",headers:{...headers,"Idempotency-Key":randomUUID()},body:JSON.stringify(input),signal});
const p=await call("preview",{cutoff:new Date(Date.now()-1000).toISOString()});assert.equal(p.status,200);const data=(await p.json()).data;
const input={previewId:data.previewId,expectedGeneration:data.expectedGeneration,expectedVersion:data.expectedVersion,candidateDigest:data.candidateDigest};
const actual=running.owned.store.backup.bind(running.owned.store);let release!:()=>void,backed!:()=>void;
let hold=new Promise<void>(resolve=>{release=resolve;}),finished=new Promise<void>(resolve=>{backed=resolve;});
running.owned.store.backup=async(...args)=>{const backup=await actual(...args);backed();await hold;return backup;};
const controller=new AbortController();const pending=call("prune",input,controller.signal).catch(error=>error);await finished;controller.abort();await pending;
await new Promise(resolve=>setTimeout(resolve,30));release();
const start=Date.now();while(running.history.diagnostics().leases && Date.now()-start<3000)await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(running.history.diagnostics().leases,0);assert.equal(running.owned.store.metadata().generation,data.expectedGeneration);
const db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});assert.deepEqual(db.prepare("SELECT count(*) n FROM receipts WHERE path='/api/v1/retention/prune'").get(),{n:0});db.close();
assert.equal(readdirSync(join(dir,"backups")).filter(name=>name.startsWith("retention-")&&name.endsWith(".sqlite")).length,1);
hold=new Promise<void>(resolve=>{release=resolve;});finished=new Promise<void>(resolve=>{backed=resolve;});
const shutdownPrune=call("prune",input).catch(error=>error);await finished;const shutdown=running.shutdown();release();await shutdownPrune;await shutdown;
const stopped=new Database(join(dir,"agentflow.sqlite"),{readonly:true});assert.deepEqual(stopped.prepare("SELECT count(*) n FROM receipts WHERE path='/api/v1/retention/prune'").get(),{n:0});assert.deepEqual(stopped.prepare("SELECT generation FROM instance_metadata").get(),{generation:data.expectedGeneration});stopped.close();
console.log(JSON.stringify({dir,cancelledBeforeCommit:true,shutdownBeforeCommit:true,backupsRetained:2,executable:process.execPath,cwd:process.cwd(),environment:{PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,npm_config_cache:process.env.npm_config_cache},generation:data.expectedGeneration}));

}catch(error){console.error(error);process.exitCode=1;}finally{await running.shutdown();}
