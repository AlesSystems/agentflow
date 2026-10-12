import { spawn } from "node:child_process";
import { createHash,randomUUID } from "node:crypto";
import { mkdtempSync,realpathSync,readFileSync,writeFileSync,readdirSync,lstatSync,mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect,it } from "vitest";
import { auditStoppedSql } from "../fixtures/w03c-campaign";
import { freePort,launch } from "../fixtures/server";
import { openOwnedStore,migrations } from "../../src/db";
const pins={P01:"a2e5170879602faff706e1aa2e5e7a1905d63b47",P04:"d84a455ff167ecfdc7ef1afc1c6e4a1983cae1fe",P07:"dd26c4b00867e7680c3baf0cf2be39b60502aecf",W01:"e5bf6da0e22a64b40fc5817fb1d3a4d237bdb168",W02:"1ce0c52ab9fedab0b8a61eb8c15131c2d8e69361",W03a:"76fe748a3d642f8a5a6ea738af47a3bb640070d3"};
function physical(root:string){
 const files:Record<string,string>={};const walk=(path:string,relative="")=>{for(const name of readdirSync(path)){if(["node_modules",".git"].includes(name))continue;const file=join(path,name),key=relative+name,stat=lstatSync(file);if(stat.isDirectory())walk(file,key+"/");else if(stat.isFile())files[key]=createHash("sha256").update(readFileSync(file)).digest("hex");}};walk(root);const stat=lstatSync(root);return {dev:stat.dev,ino:stat.ino,uid:stat.uid,mode:stat.mode&0o777,files};
}
async function command(node:string,cwd:string,args:string[],env:NodeJS.ProcessEnv){
 const child=spawn(node,args,{cwd,env,stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);const exit=await new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});return {node,cwd,args,environment:env,exit,stdout,stderr};
}
function snapshot(dir:string){
 const proof=mkdtempSync(join(realpathSync(tmpdir()),"w03b-stopped-audit-"));
 const result=auditStoppedSql(dir,proof);
 if(process.env.AGENTFLOW_W03B_UPGRADE_PROOF_DIR)writeFileSync(join(process.env.AGENTFLOW_W03B_UPGRADE_PROOF_DIR,`copied-audit-${randomUUID()}.json`),JSON.stringify(result,null,2),{mode:0o600});
 return result;
}
for(const [phase,pin] of Object.entries(pins))it(`upgrades actual ${phase} source API/local-command fixture preserving prior migration and original receipts`,async()=>{
 const historical=process.env.AGENTFLOW_W03B_HISTORICAL_ROOT,proof=process.env.AGENTFLOW_W03B_UPGRADE_PROOF_DIR;
 if(!historical||!proof)throw new Error("Actual historical source and private upgrade proof prerequisites required");
 const source=join(historical,"sources",phase),node=join(historical,"runtime/bin/node");const before=physical(source);
 const head=await command(node,source,["--input-type=module","-e","import {execFileSync} from 'node:child_process';process.stdout.write(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}));"],process.env);
 expect(head.exit).toBe(0);expect(head.stdout.trim()).toBe(pin);
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
   if(["W01","W02","W03a"].includes(phase)){
    const workflowId=randomUUID(),revisionId=randomUUID(),nodeId=randomUUID(),workflowRunId=randomUUID();
    await call("/workflows",{id:workflowId,projectId:project,name:"Preserved graph"});await call(`/workflows/${workflowId}/revisions`,{id:revisionId,expectedWorkflowVersion:1,nodes:[{id:nodeId,label:"Reported",taskId:task}],edges:[]});await call("/workflow-runs",{id:workflowRunId,workflowId,planRevisionId:revisionId});
    for(const [sequence,type,payload] of [[1,"workflow.started",{}],[2,"workflow.node.reported",{nodeId,runId,state:"succeeded"}],[3,"workflow.heartbeat",{}]] as const)await call(`/workflow-runs/${workflowRunId}/events`,{schemaVersion:1,eventId:randomUUID(),workflowRunId,sequence,type,payload,occurredAt:new Date().toISOString()});
   }
  }
  child.kill("SIGTERM");expect(await closed).toBe(0);stopped=true;
  const old=snapshot(dir);expect(old.integrity).toBe("ok");expect(old.foreignKeys).toEqual([]);
  const backup=await command(node,source,["--import","tsx","src/cli/local.ts","backup","--output",join(dir,"backups","historical.sqlite")],env);transcript.push(backup);expect(backup.exit,backup.stderr).toBe(0);
  const owned=await openOwnedStore(dir);expect(owned.store.metadata().schemaVersion).toBe(migrations.length);owned.close();const upgraded=snapshot(dir);
  for(const [table,rows] of Object.entries(old.rows)){
   if(table==="instance_metadata"||table==="migration_history")continue;
   const actual=upgraded.rows[table] as Record<string,unknown>[];
   const keys=Object.keys((rows as Record<string,unknown>[])[0]??{});const projected=actual.map(row=>Object.fromEntries(keys.map(key=>[key,row[key]])));expect(projected,phase+":"+table).toEqual(rows);
  }
  expect((upgraded.rows.migration_history as unknown[]).slice(0,(old.rows.migration_history as unknown[]).length)).toEqual(old.rows.migration_history);
  const current=await launch({dir,port});try{for(const request of requests){const reply=await fetch(current.url+"/api/v1"+request.path,{method:"POST",headers:{Authorization:"Bearer "+current.credentials().reporterToken,"Content-Type":"application/json","Idempotency-Key":request.key},body:JSON.stringify(request.input)});expect(reply.status).toBe(request.path.endsWith("/events")?200:request.status);expect(await reply.json()).toEqual(request.body);}}finally{await current.stop();}
  const after=physical(source);expect(after).toEqual(before);
  writeFileSync(join(proof,phase+".json"),JSON.stringify({phase,pin,node,source,before,after,dir,environment:env,head,launcher:{args:["--import","tsx","src/server/launcher.ts","--production"],exit:0,stdout,stderr},transcript,old,upgraded},null,2),{mode:0o600});
 }finally{if(!stopped){child.kill("SIGTERM");await closed;}mkdirSync(proof,{recursive:true,mode:0o700});writeFileSync(join(proof,phase+"-raw.json"),JSON.stringify({phase,source,node,dir,stdout,stderr,transcript},null,2),{mode:0o600});}
},60000);
