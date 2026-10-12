import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { mkdtempSync, realpathSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openOwnedStore } from "../../src/db";
import { HistoryRuntime } from "../../src/history/runtime";
import { publishRuntime, clearRuntime } from "../../src/server/runtime";
import { readConfig } from "../../src/server/config";
import { hashSecret } from "../../src/server/auth";
import { freePort } from "./server";
const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
async function until(check:()=>boolean,ms:number){const at=performance.now();while(!check() && performance.now()-at<ms)await delay(10);return check();}
let failed=false;
for(const mode of ["deadline","closing","closingDuringEnd","closingBeforeEnd","callerAbort"]){
 const dir=mkdtempSync(join(realpathSync(tmpdir()),"w03b-finalflush-"));const owned=await openOwnedStore(dir);const port=await freePort();const history=new HistoryRuntime(owned.store);
 publishRuntime(readConfig({...process.env,AGENTFLOW_DATA_DIR:dir,PORT:String(port)},"production"),owned,undefined,history);
 const secret=randomBytes(32).toString("hex");owned.store.createSession(hashSecret(secret),Date.now(),Date.now()+60000);
 const db=new Database(join(dir,"agentflow.sqlite"));
 const project=randomUUID(),task=randomUUID();const now=Date.now();
 db.prepare("INSERT INTO projects(id,name,version,created_at,updated_at) VALUES(?,'synthetic',1,?,?)").run(project,now,now);
 db.prepare("INSERT INTO tasks(id,project_id,title,description,acceptance_criteria,status,priority,tags,version,work_revision,created_at,updated_at) VALUES(?,?,'synthetic','','','backlog','normal','[]',1,1,?,?)").run(task,project,now,now);
 const insert=db.prepare("INSERT INTO comments VALUES(?,?,?,'operator',?)");db.transaction(()=>{for(let i=0;i<1;i++)insert.run(randomUUID(),task,"x".repeat(4000),now);})();db.close();
 let response:ServerResponse|undefined;let ended=false,finished=false,lastWrite=false,completeQueued=false,pendingAtEnd=0,settled=false;let listenersBefore:{finish:number;close:number;drain:number}|undefined;
 // Controlled fault at the real native end boundary: suppress end/finish, not an OS-window claim.
 const server=createServer((request,res)=>{
  response=res;listenersBefore={finish:res.listenerCount("finish"),close:res.listenerCount("close"),drain:res.listenerCount("drain")};
  const write=res.write.bind(res);res.write=((chunk:unknown,...args:unknown[])=>{const result=Reflect.apply(write,res,[chunk,...args]);if(String(chunk).includes('"kind":"complete"')){lastWrite=result;completeQueued=true;if(mode==="closingBeforeEnd")history.beginClosing();}return result;}) as typeof res.write;
  res.end=(()=>{ended=true;pendingAtEnd=res.writableLength;if(mode==="closingDuringEnd")history.beginClosing();return res;}) as typeof res.end;
  res.once("finish",()=>{finished=true;});
  const headers=new Headers({Cookie:`agentflow_session=${secret}`});
  void history.serveExport(request,res,headers,new URL(request.url!,`http://127.0.0.1:${port}`)).catch(error=>{console.error(error);res.destroy();}).finally(()=>{settled=true;});
 });
 await new Promise<void>(r=>server.listen(port,"127.0.0.1",r));const socket=connect(port,"127.0.0.1");await new Promise<void>(r=>socket.once("connect",r));socket.pause();
 try {
  socket.write(`GET /api/v1/export?content=tasks&generation=${owned.store.metadata().generation} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${secret}\r\n\r\n`);
  assert(await until(()=>ended || settled,1500),"did not reach actual final end boundary");await delay(100);
  assert(lastWrite && completeQueued,"last complete write must be true and queued");assert(!finished,"controlled end boundary must not emit finish");
  const at=performance.now();if(mode==="closing")history.beginClosing();if(mode==="callerAbort")socket.destroy();
  const released=await until(()=>settled && history.diagnostics().leases===0,mode==="deadline"?5500:500);
  const observation={fault:"native end suppressed",mode,ended,lastWrite,completeQueued,pendingAtEnd,finished,released,elapsedMs:performance.now()-at,diagnostics:history.diagnostics(),copies:readdirSync(join(dir,"exports")),listeners:response?{finish:response.listenerCount("finish"),close:response.listenerCount("close"),drain:response.listenerCount("drain")}:null,listenersBefore};
  console.log(JSON.stringify(observation));assert(released,"final flush did not settle and release lease");assert.deepEqual(observation.copies,[]);assert(response?.destroyed);
  assert.equal(response.listenerCount("finish"),listenersBefore!.finish+1); // Fixture's un-fired observation listener remains.
  assert.equal(response.listenerCount("close"),listenersBefore!.close);assert.equal(response.listenerCount("drain"),listenersBefore!.drain);
  assert.equal(owned.store.pragmas().busy_timeout,250);owned.store.revokeAll();
 }catch(error){failed=true;console.error(mode,error);}finally{socket.destroy();await history.close();await new Promise<void>(r=>server.close(()=>r()));clearRuntime();owned.close();}
}
if(failed)process.exitCode=1;
