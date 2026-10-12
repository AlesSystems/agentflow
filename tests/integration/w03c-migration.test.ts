import { restore } from "../../src/db/recovery";
import { spawn } from "node:child_process";
import { freePort, launch } from "../fixtures/server";
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, readdirSync, readFileSync, writeFileSync, lstatSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { migrations, openOwnedStore, Store } from "../../src/db";
import { acquireInstance } from "../../src/server/instance";
import { eventInput } from "../../src/contracts/observations";
import type { ApplicationCommand } from "../../src/db/application";
import { canonicalDigest } from "../../src/domain/request-digest";
const directory=()=>mkdtempSync(join(realpathSync(tmpdir()),"w03c-usage-"));
function commands(store:Store) { return (command:ApplicationCommand,now=1000)=>store.command(command,{principal:"reporter",method:"POST",path:command.kind,key:randomUUID(),digest:canonicalDigest(command.input),now}); }
async function running() {
 const dir=directory(),owned=await openOwnedStore(dir),send=commands(owned.store);
 const projectId=(send({kind:"project.create",input:{name:"Synthetic usage"}}).body.data as {id:string}).id;
 const agentId=(send({kind:"agent.create",input:{displayName:"Synthetic",source:"fixture",defaultRole:"orchestrator"}}).body.data as {id:string}).id;
 const id=randomUUID();send({kind:"run.register",input:{id,projectId,agentId,purpose:"planning"}});
 const emit=(sequence:number,type:string,payload:unknown,now=2000)=>send({kind:"run.event",id,input:eventInput.parse({schemaVersion:1,eventId:randomUUID(),runId:id,sequence,type,payload,occurredAt:"2026-10-12T00:00:00.000Z"})},now);
 return {dir,owned,id,emit,send};
}
const payload={usageId:"stable-1",source:"fixture",model:"model",measuredAt:"2026-10-12T00:00:00.000Z",inputTokens:null,outputTokens:7};
it("rejects_changed_logical_usage_without_consuming_sequence",async()=>{
 const {dir,owned,emit,id}=await running();const db=new Database(join(dir,"agentflow.sqlite"));
 try {
 emit(1,"run.started",{});emit(2,"run.usage",payload);emit(3,"run.usage",payload,3000);
 expect(db.prepare("SELECT count(*) n FROM usage_measurements").get()).toEqual({n:1});
 expect(db.prepare("SELECT usage_id,input_tokens,output_tokens,billing_basis,first_received_at FROM usage_measurements").get()).toEqual({usage_id:"stable-1",input_tokens:null,output_tokens:7,billing_basis:null,first_received_at:2000});
 expect(db.prepare("SELECT last_sequence FROM runs WHERE id=?").get(id)).toEqual({last_sequence:3});
 expect(db.prepare("SELECT count(*) n FROM run_events WHERE type='run.usage'").get()).toEqual({n:2});
 const state=()=>({run:db.prepare("SELECT * FROM runs WHERE id=?").get(id),events:db.prepare("SELECT * FROM run_events").all(),changes:db.prepare("SELECT * FROM changes").all(),usage:db.prepare("SELECT * FROM usage_measurements").all()});const before=state();
 expect(()=>emit(4,"run.usage",{...payload,outputTokens:8})).toThrow("usage_conflict");expect(state()).toEqual(before);
 expect(()=>emit(4,"run.usage",{...payload,billingBasis:"unrepresented"})).toThrow("usage_conflict");expect(state()).toEqual(before);
 expect(()=>db.exec("INSERT INTO usage_measurements SELECT run_id,'forged',event_id,'digest','fixture','model',NULL,7,NULL,0,received_at FROM run_events WHERE type='run.started'")).toThrow("usage_parent_invalid");
 for(const sql of ["UPDATE usage_measurements SET output_tokens=8","DELETE FROM usage_measurements","INSERT OR REPLACE INTO usage_measurements SELECT * FROM usage_measurements"]) expect(()=>db.exec(sql)).toThrow("usage_immutable");
 }finally{db.close();owned.close();}
});
it("preserves_exact_retry_before_terminal_lifecycle",async()=>{
 const {owned,emit,id,send}=await running();try{
 expect(()=>emit(1,"run.usage",payload)).toThrow("run_transition_invalid");emit(1,"run.started",{});
 const input=eventInput.parse({schemaVersion:1,eventId:randomUUID(),runId:id,sequence:2,type:"run.usage",payload,occurredAt:"2026-10-12T00:00:00.000Z"});const first=send({kind:"run.event",id,input});emit(3,"run.succeeded",{summary:"Synthetic"});
 expect(send({kind:"run.event",id,input},9000)).toEqual({...first,status:200});expect(()=>emit(4,"run.usage",{...payload,usageId:"new"})).toThrow("run_terminal");
 }finally{owned.close();}
});
function facts(db:Database.Database){return Object.fromEntries(["run_events","runs","run_order_allocator","receipts","changes","sqlite_sequence","gate_decisions","task_artifacts"].map(t=>[t,db.prepare(`SELECT rowid,* FROM ${t} ORDER BY rowid`).all()]));}
async function oldFixture(){
 const dir=directory(),old=await openOwnedStore(dir,migrations.slice(0,10)),send=commands(old.store);
 const projectId=(send({kind:"project.create",input:{name:"Synthetic upgrade"}}).body.data as {id:string}).id;
 const agentId=(send({kind:"agent.create",input:{displayName:"Synthetic",source:"fixture",defaultRole:"orchestrator"}}).body.data as {id:string}).id;
 const id=randomUUID();send({kind:"run.register",input:{id,projectId,agentId,purpose:"planning"}});
 for(const [sequence,type,payload] of [[1,"run.started",{}],[2,"run.progress",{message:"Synthetic"}],[3,"run.succeeded",{summary:"Synthetic"}]] as const)send({kind:"run.event",id,input:eventInput.parse({schemaVersion:1,eventId:randomUUID(),runId:id,sequence,type,payload,occurredAt:"2026-10-12T00:00:00.000Z"})});
 const taskIdForSeed=(send({kind:"task.create",input:{projectId,title:"Protected gate task"}}).body.data as {id:string}).id;old.close();const db=new Database(join(dir,"agentflow.sqlite"));db.pragma("foreign_keys=ON");db.exec("UPDATE run_events SET body=json_set(body,'$.payload',NULL),payload_pruned_at=2000 WHERE type='run.progress'");const taskId=taskIdForSeed;
 db.prepare("INSERT INTO task_artifacts VALUES(?,?,?,1,'artifact:original',0,'reporter',NULL,1000)").run(randomUUID(),taskId,id);
 const success=db.prepare("SELECT event_id FROM run_events WHERE type='run.succeeded'").get() as {event_id:string};
 db.prepare("INSERT INTO gate_decisions VALUES(?,?,?,?,1,'artifact:original',0,'review','approved','Synthetic protected evidence',1000)").run(randomUUID(),taskId,id,success.event_id);
 const before=facts(db),schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all();db.close();return {dir,before,schema};
}
it("rebuild_preserves_pruned_events_and_gate_fks",async()=>{
 const {dir,before}=await oldFixture();const owned=await openOwnedStore(dir);const db=new Database(join(dir,"agentflow.sqlite"));try{expect(facts(db)).toEqual(before);expect(owned.store.pragmas().foreign_keys).toBe(1);expect(owned.store.integrity().integrity).toBe("ok");expect(owned.store.metadata().schemaVersion).toBe(11);}finally{db.close();owned.close();}
});
it.each(["copy","drop"])("failed_rebuild_rolls_back_and_reenables_fks after %s",async(stage)=>{
 const {dir,before,schema}=await oldFixture();expect(migrations).toHaveLength(11);
 const migration=migrations[10],needle=stage==="copy"?"DROP TABLE run_events;":"ALTER TABLE run_events_new RENAME TO run_events;";
 const sql=migration.sql.replace(needle,"INSERT INTO missing_w03c_fault VALUES(1);"+needle);expect(sql).not.toBe(migration.sql);
 const owner=acquireInstance(dir),store=new Store(owner);try{
 await expect(store.migrate([...migrations.slice(0,10),{...migration,sql,sha256:createHash("sha256").update(sql).digest("hex")}])).rejects.toThrow("missing_w03c_fault");
 expect(store.pragmas().foreign_keys).toBe(1);expect(store.integrity().integrity).toBe("ok");
 const db=new Database(join(dir,"agentflow.sqlite"));try{expect(facts(db)).toEqual(before);expect(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all()).toEqual(schema);}finally{db.close();}
 expect(readdirSync(join(dir,"backups")).filter(x=>x.endsWith(".sqlite"))).toHaveLength(1);
 }finally{store.close();owner.release();}
});
it("rejects an untrusted foreign-key-disable option before backup or mutation",async()=>{
 const dir=directory(),old=await openOwnedStore(dir);const before=old.store.metadata();old.close();
 const sql="CREATE TABLE untrusted(value);";await expect(openOwnedStore(dir,[...migrations,{id:"9999_untrusted",sql,sha256:createHash("sha256").update(sql).digest("hex"),requiresForeignKeysOff:true}])).rejects.toThrow("UNTRUSTED_MIGRATION_OPTION");
 const owned=await openOwnedStore(dir);try{expect(owned.store.metadata()).toEqual(before);expect(readdirSync(dir)).not.toContain("backups");}finally{owned.close();}
});

it("closes the connection when foreign-key enforcement cannot be restored",async()=>{
 const {dir}=await oldFixture(),owner=acquireInstance(dir),store=new Store(owner),original=Database.prototype.pragma;
 let disabled=false;
 const spy=vi.spyOn(Database.prototype,"pragma").mockImplementation(function(this:Database.Database,source,options){
  if(source==="foreign_keys = OFF")disabled=true;
  if(disabled&&source==="foreign_keys = ON")throw new Error("Synthetic enable failure");
  return Reflect.apply(original,this,[source,options]);
 });
 try{await expect(store.migrate()).rejects.toThrow("Synthetic enable failure");expect(()=>store.pragmas()).toThrow("not open");}
 finally{spy.mockRestore();store.close();owner.release();}
});

const pins={W03b:"6611e8e4ed8ec61d57be689a7cfd82ee75b9275e",P01:"a2e5170879602faff706e1aa2e5e7a1905d63b47",P04:"d84a455ff167ecfdc7ef1afc1c6e4a1983cae1fe",P07:"dd26c4b00867e7680c3baf0cf2be39b60502aecf",W01:"e5bf6da0e22a64b40fc5817fb1d3a4d237bdb168",W02:"1ce0c52ab9fedab0b8a61eb8c15131c2d8e69361",W03a:"76fe748a3d642f8a5a6ea738af47a3bb640070d3"};
function physicalUpgrade(root:string){
 const files:Record<string,string>={};const walk=(path:string,relative="")=>{for(const name of readdirSync(path)){if(["node_modules",".git"].includes(name))continue;const file=join(path,name),key=relative+name,stat=lstatSync(file);if(stat.isDirectory())walk(file,key+"/");else if(stat.isFile())files[key]=createHash("sha256").update(readFileSync(file)).digest("hex");}};walk(root);const stat=lstatSync(root);return {dev:stat.dev,ino:stat.ino,uid:stat.uid,mode:stat.mode&0o777,files};
}
async function subprocessUpgrade(node:string,cwd:string,args:string[],env:NodeJS.ProcessEnv){
 const child=spawn(node,args,{cwd,env,stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);const exit=await new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});return {node,cwd,args,environment:env,exit,stdout,stderr};
}
function snapshotUpgrade(dir:string){
 const copied=mkdtempSync(join(realpathSync(tmpdir()),"w03c-sql-copy-"));const hashes:Record<string,string>={};
 for(const suffix of ["","-wal","-shm","-journal"]){const file=join(dir,"agentflow.sqlite"+suffix);if(existsSync(file)){hashes[suffix]=createHash("sha256").update(readFileSync(file)).digest("hex");copyFileSync(file,join(copied,"agentflow.sqlite"+suffix));}}
 const db=new Database(join(copied,"agentflow.sqlite"),{readonly:true});try{
 const tables=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name NOT LIKE 'sqlite_%' OR name='sqlite_sequence') ORDER BY name").all() as {name:string}[]).map(r=>r.name);
 return {integrity:db.pragma("integrity_check",{simple:true}),foreignKeys:db.pragma("foreign_key_check"),rows:Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]))};
}finally{db.close();for(const [suffix,hash] of Object.entries(hashes))expect(createHash("sha256").update(readFileSync(join(dir,"agentflow.sqlite"+suffix))).digest("hex")).toBe(hash);}}
for(const [phase,pin] of Object.entries(pins))it(`upgrades actual ${phase} source API/local-command fixture preserving prior migration and original receipts`,async()=>{
 const historical=process.env.AGENTFLOW_W03C_HISTORICAL_ROOT,proof=process.env.AGENTFLOW_W03C_UPGRADE_PROOF_DIR;
 if(!historical||!proof)throw new Error("Actual historical source and private upgrade proof prerequisites required");
 mkdirSync(proof,{recursive:true,mode:0o700});
 const source=join(historical,"sources",phase),node=join(historical,"runtime/bin/node");const before=physicalUpgrade(source);
 const head=await subprocessUpgrade(node,source,["--input-type=module","-e","import {execFileSync} from 'node:child_process';process.stdout.write(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}));"],process.env);
 if(phase!=="W03b"){expect(head.exit).toBe(0);expect(head.stdout.trim()).toBe(pin);}else{expect(head.exit).not.toBe(0);const qualified=JSON.parse(readFileSync(join(historical,"proof/W03b-source-qualified.json"),"utf8"));expect(qualified.pin).toBe(pin);for(const [file,hash] of Object.entries(qualified.files))expect(createHash("sha256").update(readFileSync(join(source,file))).digest("hex")).toBe(hash);}
 const dir=mkdtempSync(join(realpathSync(tmpdir()),"w03b-actual-")),port=await freePort(),url=`http://127.0.0.1:${port}`;
 const env:NodeJS.ProcessEnv={...process.env,NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",AGENTFLOW_DATA_DIR:dir,PORT:String(port)};
 const child=spawn(node,["--import","tsx","src/server/launcher.ts","--production"],{cwd:source,env,stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);
 const closed=new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});const transcript:unknown[]=[];let stopped=false;
 try {
  const start=Date.now();let ready=false;while(Date.now()-start<30000){if(child.exitCode!==null)throw new Error(stdout+stderr);try{ready=(await fetch(url+"/api/v1/health",{signal:AbortSignal.timeout(500)})).ok;if(ready)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}expect(ready).toBe(true);
  const credentials=JSON.parse(readFileSync(join(dir,"credentials.json"),"utf8"));
  const session=await fetch(url+"/api/v1/session",{method:"POST",headers:{Origin:url,"Content-Type":"application/json"},body:JSON.stringify({token:credentials.pairingToken})});expect(session.status).toBe(200);const cookie=session.headers.get("set-cookie")!.split(";")[0];
  const requests:{path:string;input:unknown;key:string;body:unknown;status:number}[]=[];
  const call=async(path:string,input?:unknown,human=false)=>{const key=randomUUID(),response=await fetch(url+"/api/v1"+path,{method:input?"POST":"GET",headers:{...(human?{Cookie:cookie,Origin:url}:{Authorization:"Bearer "+credentials.reporterToken}),"Content-Type":"application/json","Idempotency-Key":key},...(input?{body:JSON.stringify(input)}:{})});const body=await response.json();const record={path,input,key,body,status:response.status};transcript.push(record);if(input)requests.push(record);expect(response.ok,JSON.stringify(record)).toBe(true);return body;};
  await call("/foundation",undefined,true);
  if(phase!=="P01"){
   const project=(await call("/projects",{name:`Synthetic ${phase} upgrade`})).data.id;
   const agent=(await call("/agents",{displayName:"Synthetic source producer",source:phase,defaultRole:"implementation"})).data.id;
   const task=(await call("/tasks",{projectId:project,title:"Preserved original task"})).data.id;
   const runId=randomUUID();await call("/runs",{id:runId,projectId:project,agentId:agent,taskId:task,purpose:"implementation",expectedTaskVersion:1});
   for(const [sequence,type,payload] of [[1,"run.started",{}],[2,"run.progress",{message:"Original historical display body"}],[3,"run.succeeded",{summary:"Preserved original terminal"}]] as const)await call(`/runs/${runId}/events`,{schemaVersion:1,eventId:randomUUID(),runId,sequence,type,payload,occurredAt:new Date().toISOString()});
   if(["W01","W02","W03a","W03b"].includes(phase)){
    const workflowId=randomUUID(),revisionId=randomUUID(),nodeId=randomUUID(),workflowRunId=randomUUID();
    await call("/workflows",{id:workflowId,projectId:project,name:"Preserved graph"});await call(`/workflows/${workflowId}/revisions`,{id:revisionId,expectedWorkflowVersion:1,nodes:[{id:nodeId,label:"Reported",taskId:task}],edges:[]});await call("/workflow-runs",{id:workflowRunId,workflowId,planRevisionId:revisionId});
    for(const [sequence,type,payload] of [[1,"workflow.started",{}],[2,"workflow.node.reported",{nodeId,runId,state:"succeeded"}],[3,"workflow.heartbeat",{}]] as const)await call(`/workflow-runs/${workflowRunId}/events`,{schemaVersion:1,eventId:randomUUID(),workflowRunId,sequence,type,payload,occurredAt:new Date().toISOString()});
   }
  }
  child.kill("SIGTERM");expect(await closed).toBe(0);stopped=true;
  const old=snapshotUpgrade(dir);expect(old.integrity).toBe("ok");expect(old.foreignKeys).toEqual([]);
  const backup=await subprocessUpgrade(node,source,["--import","tsx","src/cli/local.ts","backup","--output",join(dir,"backups","historical.sqlite")],env);transcript.push(backup);expect(backup.exit,backup.stderr).toBe(0);
  const owned=await openOwnedStore(dir);expect(owned.store.metadata().schemaVersion).toBe(migrations.length);owned.close();const upgraded=snapshotUpgrade(dir);
  for(const [table,rows] of Object.entries(old.rows)){
   if(table==="instance_metadata"||table==="migration_history")continue;
   const actual=upgraded.rows[table] as Record<string,unknown>[];
   const keys=Object.keys((rows as Record<string,unknown>[])[0]??{});const projected=actual.map(row=>Object.fromEntries(keys.map(key=>[key,row[key]])));expect(projected,phase+":"+table).toEqual(rows);
  }
  expect((upgraded.rows.migration_history as unknown[]).slice(0,(old.rows.migration_history as unknown[]).length)).toEqual(old.rows.migration_history);
  const current=await launch({dir,port});try{for(const request of requests){const reply=await fetch(current.url+"/api/v1"+request.path,{method:"POST",headers:{Authorization:"Bearer "+current.credentials().reporterToken,"Content-Type":"application/json","Idempotency-Key":request.key},body:JSON.stringify(request.input)});expect(reply.status).toBe(request.path.endsWith("/events")?200:request.status);expect(await reply.json()).toEqual(request.body);}}finally{await current.stop();}
  const after=physicalUpgrade(source);expect(after).toEqual(before);
  writeFileSync(join(proof,phase+".json"),JSON.stringify({phase,pin,node,source,before,after,dir,environment:env,head,launcher:{args:["--import","tsx","src/server/launcher.ts","--production"],exit:0,stdout,stderr},transcript,old,upgraded},null,2),{mode:0o600});
 }finally{if(!stopped){child.kill("SIGTERM");await closed;}mkdirSync(proof,{recursive:true,mode:0o700});writeFileSync(join(proof,phase+"-raw.json"),JSON.stringify({phase,source,node,dir,stdout,stderr,transcript},null,2),{mode:0o600});}
},60000);

it("restores a completed failed-rebuild backup with renewed generation and unchanged protected facts",async()=>{
 const {dir,before}=await oldFixture(),owner=acquireInstance(dir),store=new Store(owner),oldGeneration=store.metadata().generation;
 const migration=migrations[10],sql=migration.sql.replace("ALTER TABLE run_events_new RENAME TO run_events;","INSERT INTO missing_restore_fault VALUES(1);ALTER TABLE run_events_new RENAME TO run_events;");
 try{await expect(store.migrate([...migrations.slice(0,10),{...migration,sql,sha256:createHash("sha256").update(sql).digest("hex")}])).rejects.toThrow("missing_restore_fault");}finally{store.close();owner.release();}
 const backup=join(dir,"backups",readdirSync(join(dir,"backups")).find(x=>x.endsWith(".sqlite"))!);
 const backupDir=directory();copyFileSync(backup,join(backupDir,"agentflow.sqlite"));expect(snapshotUpgrade(backupDir).integrity).toBe("ok");
 const result=await restore(dir,backup);expect(result.generation).not.toBe(oldGeneration);const owned=await openOwnedStore(dir);try{expect(owned.store.metadata()).toMatchObject({generation:result.generation,schemaVersion:11});expect(owned.store.sessionCount()).toBe(0);expect(owned.store.pragmas().foreign_keys).toBe(1);}finally{owned.close();}
 const restored=snapshotUpgrade(dir);for(const [table,rows] of Object.entries(before))expect(restored.rows[table]).toEqual((rows as Record<string,unknown>[]).map(({rowid,...value})=>{void rowid;return value;}));
});
