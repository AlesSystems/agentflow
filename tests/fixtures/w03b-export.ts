import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type Socket } from "node:net";
import Database from "better-sqlite3";
import { startRuntime } from "../../src/server/launcher";
import { readConfig } from "../../src/server/config";
import { hashSecret } from "../../src/server/auth";
import { historyGroups, historyLine } from "../../src/contracts/history";
import { openHistoryExportSnapshot } from "../../src/db/history";
import { freePort } from "./server";
const dir=mkdtempSync(join(realpathSync(tmpdir()),"w03b-native-"));
const port=await freePort();let outbound=0;
const running=await startRuntime(readConfig({...process.env,AGENTFLOW_DATA_DIR:dir,PORT:String(port)},"production"),{githubTransport:async()=>{outbound++;throw Error("NO_OUTBOUND");}});
const url=`http://127.0.0.1:${port}`;
const secret=randomBytes(32).toString("hex");const hash=hashSecret(secret);const cookie=`agentflow_session=${secret}`;
running.owned.store.createSession(hash,Date.now(),Date.now()+120000);
const headers={Cookie:cookie};const generation=running.owned.store.metadata().generation;
const path=`/api/v1/export?content=tasks,attempts,workflows,github&generation=${generation}`;
const db=new Database(join(dir,"agentflow.sqlite"));const unregister=running.owned.instance.registerConnection();
const sockets:Socket[]=[];
const pause=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
async function until(check:()=>boolean,timeout=8000){const at=performance.now();while(!check()){assert(performance.now()-at<timeout,"condition deadline");await pause(10);}}
function command(input:Parameters<typeof running.owned.store.command>[0]) {
 return running.owned.store.command(input,{principal:"operator",method:"POST",path:"/synthetic",key:randomUUID(),digest:randomUUID(),now:Date.now()}).body.data as Record<string,unknown>;
}
try {
const project=command({kind:"project.create",input:{name:"Synthetic coherent export",repositoryPath:"/SENTINEL_PROJECT_PATH"}});
const agent=command({kind:"agent.create",input:{displayName:"Synthetic agent",source:"fixture",defaultRole:"implementation"}});
const task=command({kind:"task.create",input:{projectId:project.id as string,title:"Synthetic task"}});
const taskId=task.id as string;
command({kind:"comment.create",id:taskId,input:{text:"Selected user text"}});
command({kind:"task.artifact",id:taskId,input:{expectedVersion:task.version as number,artifactRef:"/opaque/retained-artifact"}});
const runId=randomUUID();
command({kind:"run.register",input:{id:runId,projectId:project.id as string,agentId:agent.id as string,taskId,purpose:"implementation",expectedTaskVersion:2}});
const event=(sequence:number,type:"run.started"|"run.progress"|"run.succeeded",payload:Record<string,unknown>)=>command({kind:"run.event",id:runId,input:{schemaVersion:1,eventId:randomUUID(),runId,sequence,type,occurredAt:new Date().toISOString(),payload} as import("../../src/contracts/observations").EventInput});
event(1,"run.started",{});event(2,"run.progress",{message:"retained history"});event(3,"run.succeeded",{summary:"synthetic terminal"});
command({kind:"task.complete",id:taskId,input:{expectedVersion:5,evidenceNote:"synthetic human acceptance"}});
command({kind:"task.reopen",id:taskId,input:{expectedVersion:6,reason:"synthetic reopen"}});
const workflowId=randomUUID(),revisionId=randomUUID(),workflowRunId=randomUUID(),nodeId=randomUUID();
command({kind:"workflow.create",input:{id:workflowId,projectId:project.id as string,name:"Synthetic workflow"}});
command({kind:"workflow.revision",id:workflowId,input:{id:revisionId,expectedWorkflowVersion:1,nodes:[{id:nodeId,label:"Node",taskId}],edges:[]}});
command({kind:"workflow.run.register",input:{id:workflowRunId,workflowId,planRevisionId:revisionId}});
for(const [sequence,type,payload] of [[1,"workflow.started",{}],[2,"workflow.node.reported",{nodeId,runId,state:"succeeded"}],[3,"workflow.succeeded",{summary:"done"}]] as const)command({kind:"workflow.run.event",id:workflowRunId,input:{schemaVersion:1,eventId:randomUUID(),workflowRunId,sequence,type,occurredAt:new Date().toISOString(),payload} as import("../../src/contracts/workflows").WorkflowEventInput});
// Every structured secret slot is excluded even if later storage grows unrelated fields.
for(const [table,column,value] of [["github_connection","credential","SENTINEL_CONNECTION_SECRET"],["agents","config_path","/SENTINEL_CONFIG_PATH"],["settings","data_location","/SENTINEL_DATA_LOCATION"]]) {db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);db.prepare(`UPDATE ${table} SET ${column}=?`).run(value);}
db.prepare("UPDATE sessions SET secret_hash=? WHERE secret_hash<>?").run("SENTINEL_SESSION_SECRET",hash);
writeFileSync(join(dir,"credential-sentinel.json"),'SENTINEL_CREDENTIAL_FILE',{mode:0o600});
const secondTask=command({kind:"task.create",input:{projectId:project.id as string,title:"Prerequisite"}});
db.prepare("INSERT INTO task_dependencies VALUES(?,?,?)").run(taskId,secondTask.id,project.id);
const terminalEvent=(db.prepare("SELECT event_id FROM run_events WHERE run_id=? AND sequence=3").get(runId) as {event_id:string}).event_id;
db.prepare("INSERT INTO gate_decisions(id,task_id,run_id,event_id,work_revision,artifact_ref,rework_round,purpose,decision,evidence_note,created_at) VALUES(?,?,?,?,?,?,0,'review','approved','synthetic',?)").run(randomUUID(),taskId,runId,terminalEvent,1,"/opaque/retained-artifact",Date.now());
db.prepare("INSERT INTO task_reworks VALUES(?,?,?,1,'synthetic rework','operator',?)").run(randomUUID(),taskId,1,Date.now());
db.prepare("INSERT INTO run_closures VALUES(?,?,'synthetic closure','operator',?)").run(randomUUID(),runId,Date.now());
db.prepare("INSERT INTO workflow_closures VALUES(?,?,'synthetic closure','operator',?)").run(randomUUID(),workflowRunId,Date.now());
db.prepare("INSERT INTO github_pull_requests VALUES('synthetic/repo',1,'https://github.com/synthetic/repo/pull/1','Synthetic PR','open',0,?,'main',NULL,NULL,?,?,NULL)").run("a".repeat(40),Date.now(),Date.now());
db.prepare("INSERT INTO github_lookup_attempts VALUES('synthetic/repo',1,?,'offline')").run(Date.now());
const proof:Record<string,unknown>={cwd:process.cwd(),node:process.execPath,dataDir:dir};
async function lines(content="tasks,attempts,workflows,github") {
 const response=await fetch(url+path.replace("content=tasks,attempts,workflows,github",`content=${content}`),{headers});assert.equal(response.status,200);
 const text=await response.text();const records=text.trim().split("\n").map(line=>historyLine.parse(JSON.parse(line)));
 assert.equal(records[0].kind,"manifest");assert.equal(records.at(-1)!.kind,"complete");
 const manifest=records[0] as import("../../src/contracts/history").HistoryManifest;
 for(const [kind,count] of Object.entries(manifest.counts))assert.equal(records.slice(1,-1).filter(r=>r.kind===kind).length,count);
 assert.deepEqual((records.at(-1) as {counts:unknown}).counts,manifest.counts);
 for(const sentinel of ["SENTINEL_PROJECT_PATH","SENTINEL_CONNECTION_SECRET","SENTINEL_CONFIG_PATH","SENTINEL_DATA_LOCATION","SENTINEL_SESSION_SECRET","SENTINEL_CREDENTIAL_FILE"])assert(!text.includes(sentinel),sentinel);
 return {response,records,manifest,text};
}
 const all=await lines();assert(all.text.includes("/opaque/retained-artifact"));assert.equal(all.manifest.counts.runEvent,3);assert.equal(all.manifest.counts.nodeObservation,1);
 proof.allCounts=all.manifest.counts;for(const count of Object.values(all.manifest.counts))assert((count ?? 0)>0);
 for(const group of ["tasks","attempts","workflows","github"] as const){const selected=await lines(group);assert.deepEqual(Object.keys(selected.manifest.counts),historyGroups[group]);}
 for(const query of ["content=","content=tasks,tasks","content=github,tasks","content=invalid","content=tasks&cursor=0","content=tasks&content=github","content=tasks&extra=x","content=tasks&__proto__=x"]){const response=await fetch(`${url}/api/v1/export?${query}&generation=${generation}`,{headers});assert.equal(response.status,400);assert.equal(response.headers.get("agentflow-generation"),generation);await response.text();}
 async function rawRejected(extra:string,status:number) {
  const socket=connect(port,"127.0.0.1");sockets.push(socket);let reply="";socket.on("data",chunk=>reply+=chunk.toString());
  socket.write(`GET ${path} HTTP/1.1\r\n${extra}\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`);
  await until(()=>reply.includes("\r\n"));assert.match(reply,new RegExp(`^HTTP/1.1 ${status} `));socket.destroy();
 }
 await rawRejected("Host: evil.example",403);
 await rawRejected(`Host: 127.0.0.1:${port}\r\nOrigin: ${url}\r\nOrigin: https://evil.example`,403);
 await rawRejected(`Host: 127.0.0.1:${port}\r\nContent-Length: 1`,400);
 const stale=await fetch(url+path.replace(generation,randomUUID()),{headers});assert.equal(stale.status,409);await stale.text();
 for(const extra of [{Origin:"https://evil.example"},{"Sec-Fetch-Site":"cross-site"}] as Record<string,string>[]){const rejected=await fetch(url+path,{headers:{...headers,...extra}});assert.equal(rejected.status,403);await rejected.text();}
 for(const authorization of [running.owned.credentials.reporterToken,running.owned.credentials.pairingToken]){const response=await fetch(url+path,{headers:{Authorization:`Bearer ${authorization}`}});assert([401,403].includes(response.status));await response.text();}
 assert.equal((await fetch(url+path,{method:"HEAD",headers})).status,200);assert.equal(running.history.diagnostics().leases,0);assert.deepEqual(readdirSync(join(dir,"exports")),[]);
 const response=await fetch(url+path,{headers});const before=all.manifest.snapshotCursor;
 db.prepare("UPDATE instance_metadata SET generation=?").run(randomUUID());
 command({kind:"project.create",input:{name:"written after copy"}});
 const stopped=(await response.text()).trim().split("\n").map(line=>JSON.parse(line));
 assert.equal(stopped[0].generation,generation);assert.equal(stopped[0].snapshotCursor,before);assert(!stopped.some(line=>line.data?.name==="written after copy"));
 assert.notEqual(running.owned.store.changeBatch("0").maximum,before);assert.notEqual(running.owned.store.metadata().generation,generation);
 db.prepare("UPDATE instance_metadata SET generation=?").run(generation);
 // Reader-only marked stub in a synthetic stopped copy.
 const stubDir=mkdtempSync(join(realpathSync(tmpdir()),"w03b-stub-"));const stub=join(stubDir,"copy.sqlite");await running.owned.store.backup(stub);
 const copy=new Database(stub);copy.exec("DROP TRIGGER run_events_no_update");copy.prepare("UPDATE run_events SET body=json_set(body,'$.payload',NULL),payload_pruned_at=? WHERE type='run.progress'").run(Date.now());copy.close();
 const snapshot=openHistoryExportSnapshot(stub,{content:["attempts"],generation},Date.now());let batch;let found=false;
 while((batch=snapshot.nextBatch()).length){assert(batch.length<=100);for(const record of batch)if(record.kind==="runEvent" && record.data.type==="run.progress"){assert.equal(record.data.payload,null);assert("payloadPrunedAt" in record.data);found=true;}}
 snapshot.close();assert(found);
 // 101+ rows and native TCP pressure from realistic maximum user text.
 const insert=db.prepare("INSERT INTO comments(id,task_id,text,actor,created_at) VALUES(?,?,?,'operator',?)");
 db.transaction(()=>{for(let i=0;i<3000;i++)insert.run(randomUUID(),taskId,"x".repeat(4000),Date.now());})();
 const many=await lines("tasks");assert.equal(many.manifest.counts.comment,3001);
 const exportedIds=many.records.flatMap(record=> {
  if(record.kind!=="comment" || !("data" in record) || !("id" in record.data))return [];
  assert.equal(typeof record.data.id,"string");return [record.data.id as string];
 }).sort();
 assert.equal(new Set(exportedIds).size,3001);assert.deepEqual(exportedIds,(db.prepare("SELECT id FROM comments ORDER BY id").all() as {id:string}[]).map(row=>row.id));
 async function paused(){const socket=connect(port,"127.0.0.1");sockets.push(socket);await new Promise<void>(resolve=>socket.once("connect",resolve));socket.pause();socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${cookie}\r\n\r\n`);await until(()=>running.history.diagnostics().peakBytes>0 && running.history.diagnostics().leases>0);return socket;}
 const first=await paused(),second=await paused();await pause(200);
 const excess=await fetch(url+path,{headers});assert.equal(excess.status,429);await excess.text();
 assert(running.history.diagnostics().peakBytes<=1048576);db.prepare("UPDATE settings SET timezone='UTC'").run();
 const at=performance.now();await until(()=>running.history.diagnostics().leases===0,6500);assert(performance.now()-at<5500);assert(running.history.diagnostics().stalledCloses>=1);first.destroy();second.destroy();
 await until(()=>readdirSync(join(dir,"exports")).length===0);
 const abort=new AbortController();const interrupted=await fetch(url+path,{headers,signal:abort.signal});const reader=interrupted.body!.getReader();const chunk=await reader.read();assert(!new TextDecoder().decode(chunk.value).includes('"kind":"complete"'));abort.abort();await until(()=>running.history.diagnostics().leases===0);assert.deepEqual(readdirSync(join(dir,"exports")),[]);
 // Failure injected at the existing copy boundary, not an artificial route.
 const original=running.owned.store.backup.bind(running.owned.store);
 const failureGeneration=randomUUID();
 running.owned.store.backup=async()=>{db.prepare("UPDATE instance_metadata SET generation=?").run(failureGeneration);throw Error("SENTINEL_PRIVATE_COPY_FAILURE");};
 const failure=await fetch(url+path,{headers});assert.equal(failure.status,503);assert.equal(failure.headers.get("agentflow-generation"),failureGeneration);db.prepare("UPDATE instance_metadata SET generation=?").run(generation);assert(!(await failure.text()).includes("SENTINEL_PRIVATE_COPY_FAILURE"));assert.deepEqual(readdirSync(join(dir,"exports")),[]);
 running.owned.store.backup=async(destination,signal)=>{const result=await original(destination,signal);const broken=new Database(destination);broken.pragma("foreign_keys = OFF");broken.prepare("INSERT INTO task_dependencies VALUES(?,?,?)").run(randomUUID(),randomUUID(),randomUUID());broken.close();return result;};
 const integrity=await fetch(url+path,{headers});assert.equal(integrity.status,503);assert(!(await integrity.text()).includes("INTEGRITY"));assert.deepEqual(readdirSync(join(dir,"exports")),[]);
 running.owned.store.backup=original;
 // Real optional backup cancellation before and while native transfer is pending.
 const cancelDir=mkdtempSync(join(realpathSync(tmpdir()),"w03b-cancel-"));
 const already=new AbortController();already.abort();await assert.rejects(original(join(cancelDir,"before.sqlite"),already.signal));assert(!existsSync(join(cancelDir,"before.sqlite")));
 const during=new AbortController();const copying=original(join(cancelDir,"during.sqlite"),during.signal);setImmediate(()=>during.abort());await assert.rejects(copying);await running.owned.store.drain();db.prepare("UPDATE settings SET timezone='UTC'").run();
 const originalPrepare=running.owned.store.prepareHistoryExport.bind(running.owned.store);
 let copyEntered=false,copySettled=false;
 running.owned.store.prepareHistoryExport=async(destination,input,signal)=>{copyEntered=true;await pause(100);try{return await originalPrepare(destination,input,signal);}finally{copySettled=true;}};
 const beforeCopy=new AbortController();const pending=fetch(url+path,{headers,signal:beforeCopy.signal}).catch(()=>null);await until(()=>copyEntered);beforeCopy.abort();await pending;await until(()=>copySettled && running.history.diagnostics().leases===0);assert.deepEqual(readdirSync(join(dir,"exports")),[]);
 running.owned.store.prepareHistoryExport=originalPrepare;
 const closing=await paused();db.close();unregister();await running.shutdown();assert.equal(running.history.diagnostics().leases,0);assert.deepEqual(readdirSync(join(dir,"exports")),[]);closing.destroy();
 assert.equal(outbound,0);proof.native=running.history.diagnostics();proof.outbound=outbound;
 console.log(JSON.stringify(proof));
}catch(error){process.exitCode=1;console.error(error);}finally{for(const socket of sockets)socket.destroy();if(db.open){db.close();unregister();}await running.shutdown();}
