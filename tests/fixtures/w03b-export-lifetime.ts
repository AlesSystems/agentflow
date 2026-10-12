import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRuntime } from "../../src/server/launcher";
import { readConfig } from "../../src/server/config";
import { hashSecret } from "../../src/server/auth";
import { freePort } from "./server";
const dir=mkdtempSync(join(realpathSync(tmpdir()),"w03b-lifetime-"));const port=await freePort();
const running=await startRuntime(readConfig({...process.env,AGENTFLOW_DATA_DIR:dir,PORT:String(port)},"production"));
const secret=randomBytes(32).toString("hex");running.owned.store.createSession(hashSecret(secret),Date.now(),Date.now()+600000);
const original=running.owned.store.backup.bind(running.owned.store);
let descriptor:number|undefined;let copyEnteredAt=0,settledAt=0,descriptorClosed=false;
let cancellation:unknown;let headersStatus:number|null=null;let body="";
const proof:Record<string,unknown>={cwd:process.cwd(),node:process.execPath,dataDir:dir,buildId:readFileSync(".next/BUILD_ID","utf8"),source:Object.fromEntries(["src/history/runtime.ts","src/db/index.ts","src/server/launcher.ts","tests/fixtures/w03b-export-lifetime.ts"].map(path=>[path,createHash("sha256").update(readFileSync(path)).digest("hex")]))};
// Hold the real completed backup at its promise boundary; production owns the unchanged lifetime timer.
running.owned.store.backup=async(destination,signal)=>{
 copyEnteredAt=performance.now();await original(destination,signal);
 descriptor=openSync(destination,"r");proof.copyFile={path:destination,mode:fstatSync(descriptor).mode&0o777};
 return await new Promise<Awaited<ReturnType<typeof original>>>((_resolve,reject)=>{
  assert(signal);
  const cancel=()=>{
   cancellation={name:signal.reason?.name,message:signal.reason?.message};
   closeSync(descriptor!);try{fstatSync(descriptor!);}catch(error){descriptorClosed=(error as NodeJS.ErrnoException).code==="EBADF";}
   signal.removeEventListener("abort",cancel);
   setImmediate(()=>{settledAt=performance.now();reject(signal.reason);});
  };
  signal.addEventListener("abort",cancel,{once:true});if(signal.aborted)cancel();
 });
};
const start=performance.now();
try {
 const outcome=await new Promise<{error:string|null}>((resolve,reject)=>{
  const request=get(`http://127.0.0.1:${port}/api/v1/export?content=tasks&generation=${running.owned.store.metadata().generation}`,{headers:{Cookie:`agentflow_session=${secret}`}},response=>{
   headersStatus=response.statusCode ?? null;response.on("data",chunk=>body+=chunk.toString());response.on("end",()=>resolve({error:null}));
  });
  const limit=setTimeout(()=>{request.destroy();reject(Error("LIFETIME_TEST_DEADLINE"));},315000);
  request.once("error",error=>{clearTimeout(limit);resolve({error:(error as NodeJS.ErrnoException).code ?? error.name});});request.once("close",()=>clearTimeout(limit));
 });
 const elapsedMs=performance.now()-start;
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert(elapsedMs>=299500 && elapsedMs<305000,`literal lifetime elapsed ${elapsedMs}`);
 assert(copyEnteredAt>start);assert(settledAt>copyEnteredAt);assert(descriptorClosed);
 assert.equal(headersStatus,null);assert.equal(outcome.error,"ECONNRESET");assert(!body.includes('"kind":"complete"'));
 assert.deepEqual(readdirSync(join(dir,"exports")),[]);assert.equal(running.history.diagnostics().leases,0);
 running.owned.store.revokeAll();await running.owned.store.drain();
 Object.assign(proof,{elapsedMs,copyElapsedMs:settledAt-copyEnteredAt,cancellation,headersStatus,outcome,body,descriptorClosed,copySettled:true,exports:readdirSync(join(dir,"exports")),diagnostics:running.history.diagnostics(),liveWritable:true});
 console.log(JSON.stringify(proof));
}catch(error){process.exitCode=1;console.error(error);}finally{running.owned.store.backup=original;await running.shutdown();}
