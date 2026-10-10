import assert from "node:assert/strict";
import {existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import Database from "better-sqlite3";
import {launch} from "../fixtures/server";
import {pages,confirm} from "../fixtures/p07-load";
import {scheduleGroups} from "../fixtures/p07-scheduler";
import {plan,targets,acknowledge,cadence,distribution} from "../fixtures/p07-protocol";
import {profile} from "../fixtures/p07-diagnostic-profile";
import {flushBoundary} from "../fixtures/p07-flush-boundary";
const root=process.env.AGENTFLOW_P07_DIAGNOSTIC_ROOT!;assert(root);
const source=process.env.AGENTFLOW_P07_DIAGNOSTIC_SOURCE!;assert(source);
const original=JSON.parse(readFileSync(join(source,"load-0.json"),"utf8"));
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const prepared=existsSync(join(root,"inputs.json"));
const inputs:ReturnType<typeof plan>=prepared?JSON.parse(readFileSync(join(root,"inputs.json"),"utf8")):plan(original.fixture.runs,0).filter(event=>event.phase==="burst");
if(!prepared)for(const event of inputs){event.body.sequence+=100; if(event.message){event.message=`P07 diagnostic p${event.producer} q${event.body.sequence} ${event.body.eventId}`;event.body.payload.message=event.message;}}
if(!prepared)mkdirSync(root,{mode:0o700});
// SQLite backup API copies stopped synthetic state, including any retained WAL, read-only.
if(!prepared)for(const name of ["A","B"]){const dir=join(root,name);mkdirSync(dir,{mode:0o700});const db=new Database(join(source,"load-0","agentflow.sqlite"),{readonly:true});try{await db.backup(join(dir,"agentflow.sqlite"));}finally{db.close();}copyFileSync(join(source,"load-0","credentials.json"),join(dir,"credentials.json"));}
writeFileSync(join(root,"inputs.json"),JSON.stringify(inputs,null,2)+"\n",{mode:0o600});
const starting=(dir:string)=>{const db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});try{return {schema:db.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY name").all(),counts:Object.fromEntries(["tasks","agents","runs","run_events","changes"].map(table=>[table,db.prepare(`SELECT count(*) n FROM ${table}`).get()])),runs:db.prepare("SELECT * FROM runs ORDER BY id").all(),mix:db.prepare("SELECT type,count(*) n FROM run_events GROUP BY type ORDER BY type").all(),integrity:db.pragma("integrity_check"),foreignKeys:db.pragma("foreign_key_check"),databaseHash:createHash("sha256").update(readFileSync(join(dir,"agentflow.sqlite"))).digest("hex")};}finally{db.close();}};
const starts=[starting(join(root,"A")),starting(join(root,"B"))];assert.deepEqual(starts[0],starts[1]);writeFileSync(join(root,"starting.json"),JSON.stringify(starts,null,2)+"\n",{mode:0o600});
if(process.argv.includes("--prepare"))process.exit(0);
for(const name of ["A","B"]){
 const dir=join(root,name),observations=targets(inputs);
 const result={name,source,starting:starts[name==="A"?0:1],instrumentation:"same inspector CPU sampling; GC PerformanceObserver;100ms loop/runtime snapshots; no forced GC; fresh process, no300s controller warmup",observerWork:name==="A",observations,requests:[] as {eventId:string;runId:string;sequence:number;type:string;dueMs:number;dispatchMs:number;responseMs:number|null;status:number|null;raw:string|null;ack:unknown;error:string|null}[],measuredStartedMs:null as number|null,measuredEndedMs:null as number|null,elapsedMs:null as number|null,failure:"",reconciliationStatus:"unfinalized",reconciliation:null as unknown,controllerProfile:null as unknown,serverProfile:null as unknown,browser:null as string|null,snapshots:[] as {path:string;method:string}[],cadence:null as unknown,http:null as unknown};
 const save=()=>writeFileSync(join(root,`${name}.json`),JSON.stringify(result,null,2)+"\n",{mode:0o600});save();
 let server:Awaited<ReturnType<typeof launch>>|undefined,tabs:Awaited<ReturnType<typeof pages>>|undefined,finish:(()=>Promise<unknown>)|undefined,observing=true;const observers:Promise<void>[]=[];
 async function marker(action:string){server!.child.stdin!.write(JSON.stringify({action,path:join(root,`${name}-server-profile.json`)})+"\n");const start=performance.now();for(;;){const line=server!.logs().split("\n").find(line=>line.startsWith("DIAGNOSTIC ")&&JSON.parse(line.slice(11)).action===action);if(line)return JSON.parse(line.slice(11));assert(performance.now()-start<10000,"PROFILE_MARKER_TIMEOUT");await wait(10);}}
 try{await flushBoundary(result,async()=>{
  server=await launch({dir,entry:"tests/fixtures/p07-diagnostic-runtime.ts",stdin:true});
  if(name==="A"){
   tabs=await pages(server,original.fixture.projectId);result.browser=tabs.browser.version();
   for(const page of tabs.pages)page.on("request",request=>{const url=new URL(request.url());if(url.pathname.startsWith("/api/"))result.snapshots.push({path:url.pathname,method:request.method()});});
   await Promise.all(tabs.pages.map((page,tab)=>confirm(page,observations.find(row=>row.tab===tab)!)));
   for(const [tab,page]of tabs.pages.entries())observers.push((async()=>{while(observing){for(const row of observations.filter(row=>row.tab===tab&&row.dispatchMs!==null&&row.confirmedMs===null&&row.errors.length===0)){try{await confirm(page,row);}catch(error){row.errors.push((error as Error).message);}}await wait(10);}})());
  }
  await marker("start");finish=await profile(join(root,`${name}-controller-profile.json`));
  const headers={Authorization:"Bearer "+server.credentials().reporterToken,"Content-Type":"application/json"};
  const start=result.measuredStartedMs=performance.now();
  await scheduleGroups(inputs,10,start,event=>event.dueMs,async(event,dispatchMs)=>{
   const record={eventId:event.body.eventId,runId:event.body.runId,sequence:event.body.sequence,type:event.body.type,dueMs:event.dueMs,dispatchMs,responseMs:null as number|null,status:null as number|null,raw:null as string|null,ack:null as unknown,error:null as string|null};result.requests.push(record);observations.filter(row=>row.event===event).forEach(row=>row.dispatchMs=dispatchMs);
   try{const response=await fetch(server!.url+`/api/v1/runs/${event.body.runId}/events`,{method:"POST",headers,body:JSON.stringify(event.body)});record.status=response.status;record.raw=await response.text();record.responseMs=performance.now();record.ack=JSON.parse(record.raw);assert.equal(response.status,201);const ack=acknowledge(record.ack,event);observations.filter(row=>row.event===event).forEach(row=>row.receivedAt=ack.data.receivedAt);}catch(error){record.error=(error as Error).message;throw error;}
  });
  while(performance.now()<start+10000)await wait(start+10000-performance.now());result.measuredEndedMs=performance.now();result.elapsedMs=result.measuredEndedMs-start;
  result.http=distribution(result.requests.map(row=>row.responseMs!-row.dispatchMs));save();
  result.cadence=cadence(10000,100,start,result.measuredEndedMs,result.requests);result.reconciliationStatus="diagnostic only";
 },[
  ["stop observer polling",async()=>{observing=false;await Promise.allSettled(observers);}],
  ["controller profile",async()=>{if(finish)result.controllerProfile=await finish();}],
  ["server profile",async()=>{if(server)result.serverProfile=await marker("end");}],
  ["save raw server logs",async()=>{if(server)writeFileSync(join(root,`${name}-server.log`),server.logs(),{mode:0o600});}],
  ["close two contexts",async()=>{await tabs?.browser.close();}],
  ["stop server",async()=>{await server?.stop();}]
 ],save);}catch(error){writeFileSync(join(root,`${name}-error.txt`),String(error)+"\n",{mode:0o600});}
}
