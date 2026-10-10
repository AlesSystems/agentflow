import {failureFact} from "./p07-warm-error";
import {scheduleGroups} from "./p07-scheduler";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import {resourceBoundary,type ResourceInterval} from "./p07-resource-boundary";
import { launch, pair } from "./server";
import { seedPerformance } from "./p06-performance";
import { eventsResponse,eventResponse,eventInput,eventRecord } from "../../src/contracts/observations";
import { canonicalDigest } from "../../src/domain/request-digest";
import { plan, targets, acknowledge, cadence, reconcile, distribution, type Target } from "./p07-protocol";
async function untilDue(due:number){while(performance.now()<due)await wait(due-performance.now());}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, Math.max(0,ms)));
export async function pages(server: Awaited<ReturnType<typeof launch>>, projectId: string) {
  const browser = await chromium.launch({ channel: "chrome" });
  const result: Page[] = [];
  try {
    for (let tab=0;tab<2;tab++) {
      const cookie = await pair(server);
      const context = await browser.newContext({viewport:{width:1440,height:1200}});
      await context.route("**/*", route => new URL(route.request().url()).origin === server.url ? route.continue() : route.abort());
      await context.addCookies([{ name:"agentflow_session", value:cookie.slice(cookie.indexOf("=")+1),url:server.url,httpOnly:true }]);
      const page = await context.newPage(); await page.goto(server.url+`/activity?projectId=${projectId}`);
      await expect(page.getByText("Connected updates",{exact:true})).toBeVisible();
      assert.equal(await page.evaluate(() => document.visibilityState),"visible"); result.push(page);
    }
    return {browser,pages:result};
  } catch(error) { await browser.close(); throw error; }
}
export async function confirm(page: Page, row: Target) {
  const result = await page.evaluate<{receivedAt:string|null;twoFrames:boolean}|null>(`(async () => {
    const {message,runId} = ${JSON.stringify({message:row.event.message!,runId:row.event.body.runId})};
    function inspect() {
      const node=[...document.querySelectorAll(".activity-list .preserve-lines")].find(node => node.textContent===message);
      if(!node || node.closest("details")) return null;
      const li=node.closest("li"); if(!li)return null;
      if(!li.querySelector("a[href='/runs/"+runId+"']")) return null;
      const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
      const x=rect.left+rect.width/2,y=rect.top+rect.height/2;
      if(document.visibilityState!=="visible"||rect.top<0||rect.bottom>innerHeight||rect.left<0||rect.right>innerWidth||rect.width<=0||rect.height<=0||style.visibility!=="visible"||style.display==="none"||Number(style.opacity)===0||document.elementFromPoint(x,y)?.closest("li")!==li)return null;
      return {receivedAt:li.querySelector("time")?.getAttribute("datetime")??null,style:{display:style.display,visibility:style.visibility,opacity:style.opacity},hitTest:true,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},viewport:{width:innerWidth,height:innerHeight},visibility:document.visibilityState};
    }
    const first=inspect();if(!first)return null;
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    const second=inspect();if(!second||second.receivedAt!==first.receivedAt)return null;
    return {...second,message,runId,twoFrames:true};
  })()`);
  if(result) { row.confirmedMs=performance.now();row.observedReceipt=result.receivedAt;row.observation=result; return result; }
  return null;
}
type ReportFact={body:unknown;digest:string;status:number;ack:unknown};
type StoredEvent={event_id:string;run_id:string;sequence:number;body:string;digest:string;acknowledgement:string;received_at:number;occurred_at:number};
type CapturedPage={runId:string;cursor:string|null;status:number;generation:string|null;text:string|null;error:ReturnType<typeof failureFact>|null;parsed:ReturnType<typeof eventsResponse.parse>|null};
type LoadPhase={phase:"sustained"|"burst";startedMs:number;endedMs:number|null;cadence:unknown;http:unknown;failure:string|null};
type LoadServer=Awaited<ReturnType<typeof launch>>;
export type LoadHooks={
 launchOptions?:{entry:string;stdin:boolean};beforeLaunch?:(dir:string)=>void;
 start?:(server:LoadServer)=>Promise<void>;phase?:(phase:"sustained"|"burst")=>void;
 cleanup?:(server:LoadServer|undefined)=>[string,()=>Promise<void>][];facts?:unknown;
};
export async function loadScenario(root: string,index: number,acceptance: boolean,hooks?:LoadHooks) {
  const dir=join(root,`load-${index}`),proof=join(root,`load-${index}.json`);
  const counts=acceptance?{tasks:1000,events:10000,producers:10}:{tasks:12,events:20,producers:2};
  const fixture=await seedPerformance(dir,counts,Date.now()-3600000);
  const events=plan(fixture.runs,index,!acceptance),observations=targets(events);
  const result={index,acceptance,counts,fixture,events,observations,setup:[] as ReportFact[],final:[] as ReportFact[],requests:[] as {eventId:string;body:unknown;digest:string;dueMs:number;dispatchMs:number;responseMs:number|null;status:number|null;ack:unknown;error:string|null}[],phases:[] as LoadPhase[],browser: null as string|null,seedLatestReceipt:null as string|null,reconciliation:null as unknown,failure:null as string|null,finishedMs:null as number|null,retention:undefined as {artifactStatus:string;saveFailures:{boundary:string;error:ReturnType<typeof failureFact>}[];cleanupFailures:{action:string;error:ReturnType<typeof failureFact>}[]}|undefined,postTiming:{status:"unfinalized",startedMs:null as number|null,endedMs:null as number|null,responseEncoding:"captured UTF-8 response text decoded by Fetch; not wire framing/compressed bytes",producerSerialization:"producer envelopes retained; serialized byte lengths would be reconstructed, not original transport capture",api:[] as CapturedPage[],database:{generation:null as string|null,rows:null as StoredEvent[]|null,counts:null as Record<string,number|null>|null,integrity:null as unknown,foreignKeys:null as unknown,error:null as ReturnType<typeof failureFact>|null},expected:null as {eventIds:string[];counts:Record<string,number>}|null},diagnostic:hooks?{scope:"service+controller across sustained and burst; start before sustained, no interphase handshake",start:null as unknown,phaseAnchors:[] as unknown[],profileFacts:hooks.facts,profileCleanup:null as {failures:{action:string;error:string;facts?:unknown}[]}|null,cleanup:null as {failures:{action:string;error:string}[]}|null}:undefined};
  let failed=false,primary:unknown;
  function capture(error:unknown){
    if(!failed){failed=true;primary=error;result.failure=error instanceof Error?error.message:"non-Error thrown value";try{if(error!==null&&(typeof error==="object"||typeof error==="function"))Object.defineProperty(error,"loadFacts",{value:result,configurable:true});}catch{}}
    result.reconciliation=null;result.postTiming.status="unfinalized";
  }
  function retention(){return result.retention??={artifactStatus:"unknown after persistence failure",saveFailures:[],cleanupFailures:[]};}
  function save(boundary="receipt",critical=true){
    const prior=failed;
    try{writeFileSync(proof,JSON.stringify(result,null,2)+"\n",{mode:0o600});}
    catch(error){capture(error);retention().saveFailures.push({boundary,error:failureFact(error)});if(critical&&!prior)throw primary;}
  }
  let server:Awaited<ReturnType<typeof launch>>|undefined,tabs:Awaited<ReturnType<typeof pages>>|undefined;
  let observing=true;const observers:Promise<void>[]=[];
  let profilesFinished=false;
  async function finishProfiles(){
    if(!hooks||profilesFinished)return;profilesFinished=true;save("before profile cleanup",false);
    result.diagnostic!.profileCleanup={failures:[]};
    for(const [action,work]of hooks.cleanup?.(server)??[]){try{await work();}catch(error){result.diagnostic!.profileCleanup.failures.push({action,error:error instanceof Error?error.message:"non-Error thrown value",facts:error!==null&&typeof error==="object"&&"profileFacts" in error?error.profileFacts:undefined});capture(error);}}
    save("after profile cleanup",false);
  }
  try {
    save("initial");
    const db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});
    try { const latest=db.prepare("SELECT max(received_at) latest FROM run_events").get() as {latest:number};result.seedLatestReceipt=new Date(latest.latest).toISOString();assert(latest.latest<Date.now(),"SEED_RECEIPT_IN_FUTURE"); } finally {db.close();}
    hooks?.beforeLaunch?.(dir);
    server=await launch({dir,...hooks?.launchOptions});
    const headers={Authorization:"Bearer "+server.credentials().reporterToken,"Content-Type":"application/json"};
    for(const runId of fixture.runs) {
      const body={schemaVersion:1,eventId:randomUUID(),runId,sequence:1,type:"run.started",occurredAt:new Date().toISOString(),payload:{}};
      const response: Response=await fetch(server.url+`/api/v1/runs/${runId}/events`,{method:"POST",headers,body:JSON.stringify(body)});
      const ack=await response.json();result.setup.push({body,digest:canonicalDigest(body),status:response.status,ack});assert.equal(response.status,201);eventResponse.parse(ack);
    }
    tabs=await pages(server,fixture.projectId);result.browser=tabs.browser.version();
    await Promise.all(tabs.pages.map((page,tab)=>confirm(page,observations.find(row=>row.tab===tab)!)));
    for(const [tab,page]of tabs.pages.entries()) observers.push((async()=>{
      while(observing){
        for(const row of observations.filter(row=>row.tab===tab&&row.dispatchMs!==null&&row.confirmedMs===null&&row.errors.length===0)) {
          try { await confirm(page,row); } catch(error) {row.errors.push((error as Error).message);}
        }
        await wait(10);
      }
    })());
    if(hooks){const anchor={startedMs:performance.now(),endedMs:null as number|null,wallMs:Date.now(),memory:process.memoryUsage()};result.diagnostic!.start=anchor;try{await hooks.start?.(server);}catch(error){capture(error);throw primary;}finally{anchor.endedMs=performance.now();save("profile start bookkeeping");}}
    for(const phase of ["sustained","burst"] as const) {
      if(hooks){const startedMs=performance.now();hooks.phase?.(phase);result.diagnostic!.phaseAnchors.push({phase,startedMs,endedMs:performance.now(),wallMs:Date.now(),memory:process.memoryUsage()});}
      const start=performance.now(),duration=phase==="sustained"?(acceptance?300000:6000):(acceptance?10000:3000),interval=phase==="sustained"?500:100;
      const timed={phase,startedMs:start,endedMs:null as number|null,cadence:null as unknown,http:null as unknown,failure:null as string|null};result.phases.push(timed);save("phase start");
      try {
        const batch=events.filter(event=>event.phase===phase);
        await scheduleGroups(batch,counts.producers,start,event=>event.dueMs,async(event,dispatchMs)=>{
            const record={eventId:event.body.eventId,body:event.body,digest:canonicalDigest(event.body),dueMs:event.dueMs,dispatchMs,responseMs:null as number|null,status:null as number|null,ack:null as unknown,error:null as string|null};result.requests.push(record);
            observations.filter(row=>row.event===event).forEach(row=>row.dispatchMs=record.dispatchMs);
            try {
              const response: Response=await fetch(server!.url+`/api/v1/runs/${event.body.runId}/events`,{method:"POST",headers,body:JSON.stringify(event.body)});
              record.status=response.status;record.ack=await response.json();record.responseMs=performance.now();
              assert.equal(response.status,201,"NEW_EVENT_REJECTED");const ack=acknowledge(record.ack,event);
              observations.filter(row=>row.event===event).forEach(row=>row.receivedAt=ack.data.receivedAt);
            } catch(error) {record.error=(error as Error).message;throw error;}
        });
        await untilDue(start+duration);timed.endedMs=performance.now();
        const records=result.requests.filter(record=>batch.some(event=>event.body.eventId===record.eventId));
        assert.equal(records.length,batch.length);if(hooks)timed.http=distribution(records.map(record=>record.responseMs!-record.dispatchMs));timed.cadence=cadence(duration,interval,start,timed.endedMs,records);timed.http??=distribution(records.map(record=>record.responseMs!-record.dispatchMs));
        if(acceptance&&phase==="sustained") assert((timed.http as {p95Ms:number}).p95Ms<250,"SUSTAINED_HTTP_BUDGET");
      } catch(error) {timed.endedMs??=performance.now();timed.failure=error instanceof Error?error.message:"non-Error thrown value";capture(error);throw primary;} finally {save("phase finally");}
    }
    if(hooks)await finishProfiles();if(failed)throw primary;
    const drain=performance.now();while(observations.some(row=>row.confirmedMs===null)&&performance.now()-drain<10000)await wait(25);
    observing=false;await Promise.all(observers);
    const summaries=[];for(const phase of ["sustained","burst"])for(const tab of [0,1])summaries.push({phase,tab,...reconcile(observations.filter(row=>row.tab===tab&&row.event.phase===phase),acceptance)});
    for(const runId of fixture.runs){
      const sequence=events.filter(event=>event.body.runId===runId).at(-1)!.body.sequence+1;
      const body={schemaVersion:1,eventId:randomUUID(),runId,sequence,type:"run.succeeded",occurredAt:new Date().toISOString(),payload:{summary:"Synthetic P07 load terminal outside timing"}};
      const response:Response=await fetch(server.url+`/api/v1/runs/${runId}/events`,{method:"POST",headers,body:JSON.stringify(body)});
      const ack=await response.json();result.final.push({body,digest:canonicalDigest(body),status:response.status,ack});assert.equal(response.status,201);eventResponse.parse(ack);
    }
    result.postTiming.startedMs=performance.now();
    const expected=[...result.setup,...result.requests,...result.final];
    result.postTiming.expected={eventIds:expected.map(row=>eventInput.parse(row.body).eventId),counts:{tasks:counts.tasks,agents:counts.producers,runs:counts.producers*2,run_events:counts.events+expected.length}};
    const database=result.postTiming.database,persisted=new Database(join(dir,"agentflow.sqlite"),{readonly:true});
    try{
      database.generation=(persisted.prepare("SELECT generation FROM instance_metadata").get() as {generation:string}|undefined)?.generation??null;
      database.rows=persisted.prepare(`SELECT event_id,run_id,sequence,digest,body,acknowledgement,received_at,occurred_at FROM run_events WHERE run_id IN (${fixture.runs.map(()=>"?").join(",")}) ORDER BY run_id,sequence`).all(...fixture.runs) as StoredEvent[];
      const tables=["projects","tasks","agents","runs","run_events","changes"];database.counts=Object.fromEntries(tables.map(table=>[table,null]));for(const table of tables)database.counts[table]=(persisted.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}|undefined)?.n??null;
      database.integrity=persisted.pragma("integrity_check",{simple:true});database.foreignKeys=persisted.pragma("foreign_key_check");
    }catch(error){database.error=failureFact(error);capture(error);throw primary;}
    finally{try{persisted.close();}catch(error){capture(error);retention().cleanupFailures.push({action:"close post-timing database",error:failureFact(error)});}}
    if(failed)throw primary;
    const api: (typeof eventsResponse)["_output"]["data"]["items"] = [];
    for(const runId of fixture.runs){let cursor:string|null=null;do{
      const response:Response=await fetch(server.url+`/api/v1/runs/${runId}/events?limit=100`+(cursor?`&cursor=${encodeURIComponent(cursor)}`:""),{headers});
      const page:CapturedPage={runId,cursor,status:response.status,generation:response.headers.get("agentflow-generation"),text:null,error:null,parsed:null};result.postTiming.api.push(page);
      try{page.text=await response.text();}catch(error){page.error=failureFact(error);throw error;}
      assert.equal(response.status,200,"API_STATUS");page.parsed=eventsResponse.parse(JSON.parse(page.text));api.push(...page.parsed.data.items);cursor=page.parsed.data.nextCursor;
    }while(cursor);}
    assert.equal(new Set(result.postTiming.expected.eventIds).size,expected.length,"DUPLICATE_EXPECTED_EVENT");
    assert.equal(api.length,expected.length,"API_COUNT");assert.equal(new Set(api.map(event=>event.eventId)).size,expected.length,"DUPLICATE_API_EVENT");
    assert.equal(database.rows!.length,expected.length,"DATABASE_CURRENT_EVENT_COUNT");assert.equal(new Set(database.rows!.map(row=>row.event_id)).size,expected.length,"DUPLICATE_DATABASE_EVENT");
    assert(database.generation,"DATABASE_GENERATION");for(const page of result.postTiming.api){assert.equal(page.generation,database.generation,"API_HEADER_GENERATION");assert.equal(page.parsed!.generation,database.generation,"API_BODY_GENERATION");}
    for(const [table,count]of Object.entries(result.postTiming.expected.counts))assert.equal(database.counts![table],count,"DATABASE_COUNT_"+table);
    for(const report of expected){
      const input=eventInput.parse(report.body);const row:StoredEvent|undefined=database.rows!.find(row=>row.event_id===input.eventId);assert(row,"PERSISTED_EVENT_MISSING");
      assert.equal(report.status,201,"ORIGINAL_EVENT_STATUS");const stored=eventRecord.parse(JSON.parse(row.body)),{receivedAt,...storedInput}=stored;
      assert.deepEqual(storedInput,input,"STORED_INPUT");assert.equal(row.digest,report.digest,"STORED_DIGEST");assert.equal(canonicalDigest(storedInput),report.digest,"STORED_BODY_DIGEST");
      assert.equal(row.run_id,input.runId,"STORED_RUN");assert.equal(row.sequence,input.sequence,"STORED_SEQUENCE");assert.equal(row.occurred_at,Date.parse(input.occurredAt),"STORED_OCCURRED_TIME");assert.equal(row.received_at,Date.parse(receivedAt),"STORED_RECEIVED_TIME");
      const originalAck=eventResponse.parse(report.ack),storedAck=eventResponse.parse(JSON.parse(row.acknowledgement));assert.equal(originalAck.generation,database.generation,"ORIGINAL_ACK_GENERATION");assert.equal(storedAck.generation,database.generation,"STORED_ACK_GENERATION");
      assert.deepEqual(originalAck.data,{eventId:input.eventId,runId:input.runId,acceptedSequence:input.sequence,receivedAt},"ORIGINAL_ACK_BODY");assert.deepEqual(storedAck.data,originalAck.data,"STORED_ACK_BODY");
      const publicEvent=api.find(event=>event.eventId===input.eventId);assert(publicEvent,"PUBLIC_EVENT_MISSING");assert.deepEqual(publicEvent,stored,"PUBLIC_BODY_RECEIPT");
    }
    assert.equal(database.integrity,"ok","DATABASE_INTEGRITY");assert.deepEqual(database.foreignKeys,[],"DATABASE_FOREIGN_KEYS");
    result.postTiming.status="finalized";result.postTiming.endedMs=performance.now();
    result.reconciliation={status:"finalized",expected:events.length,storedTimed:result.requests.length,apiCount:api.length,setupCount:result.setup.length,finalCount:result.final.length,summaries,burstPrecision:"four samples per full scenario/tab; nearest-rank p95 is maximum"};
  }catch(error){capture(error);throw primary;}
  finally{
    for(const phase of result.phases)if(phase.endedMs===null){phase.endedMs=performance.now();if(failed)phase.failure=result.failure;}
    if(result.postTiming.startedMs!==null&&result.postTiming.endedMs===null)result.postTiming.endedMs=performance.now();
    result.finishedMs=performance.now();save("before outer cleanup",false);
    await finishProfiles();
    if(hooks)result.diagnostic!.cleanup={failures:[]};
    for(const [action,work]of [["stop observer polling",async()=>{observing=false;await Promise.allSettled(observers);}], ["close browser",async()=>{await tabs?.browser.close();}], ["stop server",async()=>{await server?.stop();}]] as [string,()=>Promise<void>][]){try{await work();}catch(error){capture(error);retention().cleanupFailures.push({action,error:failureFact(error)});result.diagnostic?.cleanup?.failures.push({action,error:error instanceof Error?error.message:"non-Error thrown value"});}}
    save("after outer cleanup",false);if(failed)throw primary;
  }
  return result;
}
export async function resourceProof(root:string,acceptance:boolean){
  const dir=join(root,"resources"),proof=join(root,"resources.json");
  const fixture=await seedPerformance(dir,acceptance?{tasks:1000,events:10000,producers:10}:{tasks:12,events:20,producers:2},Date.now()-3600000);
  const result:ResourceInterval & {dir:string;plannedCycles:number;cycles:number;before:unknown;after:unknown;shutdown:unknown;countsBefore:unknown;countsAfter:unknown;startedMs:number}={status:"unfinalized",dir,plannedCycles:acceptance?100:2,cycles:0,before:null as unknown,after:null as unknown,shutdown:null as unknown,countsBefore:null as unknown,countsAfter:null as unknown,failure:null as string|null,startedMs:performance.now(),endedMs:null as number|null};
  const save=()=>writeFileSync(proof,JSON.stringify(result,null,2)+"\n",{mode:0o600});
  const counts=()=>{const db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});try{return Object.fromEntries(["tasks","run_events","runs","changes"].map(table=>[table,(db.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n]));}finally{db.close();}};
  let server:Awaited<ReturnType<typeof launch>>|undefined,tabs:Awaited<ReturnType<typeof pages>>|undefined;
  let ordinal=0;
  async function diagnose(){const id=++ordinal;server!.child.stdin!.write(JSON.stringify({id})+"\n");const start=performance.now();for(;;){const line=server!.logs().split("\n").find(line=>line.startsWith("MEASURE ")&&JSON.parse(line.slice(8)).id===id);if(line)return JSON.parse(line.slice(8));assert(performance.now()-start<10000,"METRICS_TIMEOUT");await wait(25);}}
  await resourceBoundary(result,async()=>{
    server=await launch({dir,entry:"tests/fixtures/p07-runtime.ts",nodeArgs:["--expose-gc"],stdin:true});
    tabs=await pages(server,fixture.projectId);await wait(1000);
    result.countsBefore=counts();result.before=await diagnose();
    const cookie=await pair(server);
    const snapshot=await (await fetch(server.url+"/api/v1/overview?timezone=UTC",{headers:{Cookie:cookie}})).json();
    for(let cycle=0;cycle<result.plannedCycles;cycle++){
      const abort=new AbortController();const response: Response=await fetch(server.url+`/api/v1/changes/stream?after=0&generation=${snapshot.generation}`,{headers:{Cookie:cookie},signal:abort.signal});assert.equal(response.status,200);const reader=response.body!.getReader();await reader.read();abort.abort();await reader.cancel().catch(()=>{});result.cycles++;
    }
    await wait(500);result.after=await diagnose();result.countsAfter=counts();assert.deepEqual(result.countsAfter,result.countsBefore);
    const before=result.before as {memory:{heapUsed:number};streams:{leases:number}},after=result.after as typeof before;
    assert.equal(after.streams.leases,before.streams.leases);if(acceptance)assert(after.memory.heapUsed<=before.memory.heapUsed*1.2,"SERVER_HEAP_BUDGET");
  },[
    ["close tabs",async()=>{await tabs?.browser.close();tabs=undefined;}],
    ["closed stream checks",async()=>{if(!server)return;await wait(200);const closed=await diagnose();assert.equal(closed.streams.leases,0);assert.equal(closed.streams.timers,0);}],
    ["stop server",async()=>{await server?.stop();}],
    ["shutdown checks",async()=>{if(!server)return;const line=server.logs().split("\n").find(line=>line.startsWith("SHUTDOWN "));assert(line,"SHUTDOWN_METRICS_MISSING");result.shutdown=JSON.parse(line.slice(9));const shutdown=result.shutdown as {streams:{leases:number;timers:number};runtime:{activeSockets:number;requests:number}};assert.equal(shutdown.streams.leases,0);assert.equal(shutdown.streams.timers,0);assert.equal(shutdown.runtime.activeSockets,0);assert.equal(shutdown.runtime.requests,0);}],
    ["remaining teardown",async()=>{await tabs?.browser.close();await server?.stop();}]
  ],save);
  return result;
}
