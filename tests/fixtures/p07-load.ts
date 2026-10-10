import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import {resourceBoundary,type ResourceInterval} from "./p07-resource-boundary";
import { launch, pair } from "./server";
import { seedPerformance } from "./p06-performance";
import { eventsResponse,eventResponse } from "../../src/contracts/observations";
import { canonicalDigest } from "../../src/domain/request-digest";
import { plan, targets, acknowledge, cadence, reconcile, distribution, type Target } from "./p07-protocol";
async function untilDue(due:number){while(performance.now()<due)await wait(due-performance.now());}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, Math.max(0,ms)));
async function pages(server: Awaited<ReturnType<typeof launch>>, projectId: string) {
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
export async function loadScenario(root: string,index: number,acceptance: boolean) {
  const dir=join(root,`load-${index}`),proof=join(root,`load-${index}.json`);
  const counts=acceptance?{tasks:1000,events:10000,producers:10}:{tasks:12,events:20,producers:2};
  const fixture=await seedPerformance(dir,counts,Date.now()-3600000);
  const events=plan(fixture.runs,index,!acceptance),observations=targets(events);
  const result={index,acceptance,counts,fixture,events,observations,setup:[] as unknown[],final:[] as unknown[],requests:[] as {eventId:string;body:unknown;digest:string;dueMs:number;dispatchMs:number;responseMs:number|null;status:number|null;ack:unknown;error:string|null}[],phases:[] as unknown[],browser: null as string|null,seedLatestReceipt:null as string|null,reconciliation:null as unknown,failure:null as string|null,finishedMs:null as number|null};
  const save=()=>writeFileSync(proof,JSON.stringify(result,null,2)+"\n",{mode:0o600});
  save();let server:Awaited<ReturnType<typeof launch>>|undefined,tabs:Awaited<ReturnType<typeof pages>>|undefined;
  let observing=true;const observers:Promise<void>[]=[];
  try {
    const db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});
    try { const latest=db.prepare("SELECT max(received_at) latest FROM run_events").get() as {latest:number};result.seedLatestReceipt=new Date(latest.latest).toISOString();assert(latest.latest<Date.now(),"SEED_RECEIPT_IN_FUTURE"); } finally {db.close();}
    server=await launch({dir});
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
    for(const phase of ["sustained","burst"] as const) {
      const start=performance.now(),duration=phase==="sustained"?(acceptance?300000:6000):(acceptance?10000:3000),interval=phase==="sustained"?500:100;
      const timed={phase,startedMs:start,endedMs:null as number|null,cadence:null as unknown,http:null as unknown,failure:null as string|null};result.phases.push(timed);save();
      try {
        const batch=events.filter(event=>event.phase===phase);
        for(let offset=0;offset<batch.length;offset+=counts.producers) {
          const group=batch.slice(offset,offset+counts.producers);await untilDue(start+group[0].dueMs);
          await Promise.all(group.map(async event=>{
            const record={eventId:event.body.eventId,body:event.body,digest:canonicalDigest(event.body),dueMs:event.dueMs,dispatchMs:performance.now(),responseMs:null as number|null,status:null as number|null,ack:null as unknown,error:null as string|null};result.requests.push(record);
            observations.filter(row=>row.event===event).forEach(row=>row.dispatchMs=record.dispatchMs);
            try {
              const response: Response=await fetch(server!.url+`/api/v1/runs/${event.body.runId}/events`,{method:"POST",headers,body:JSON.stringify(event.body)});
              record.status=response.status;record.ack=await response.json();record.responseMs=performance.now();
              assert.equal(response.status,201,"NEW_EVENT_REJECTED");const ack=acknowledge(record.ack,event);
              observations.filter(row=>row.event===event).forEach(row=>row.receivedAt=ack.data.receivedAt);
            } catch(error) {record.error=(error as Error).message;throw error;}
          }));
        }
        await untilDue(start+duration);timed.endedMs=performance.now();
        const records=result.requests.filter(record=>batch.some(event=>event.body.eventId===record.eventId));
        assert.equal(records.length,batch.length);timed.cadence=cadence(duration,interval,start,timed.endedMs,records);timed.http=distribution(records.map(record=>record.responseMs!-record.dispatchMs));
        if(acceptance&&phase==="sustained") assert((timed.http as {p95Ms:number}).p95Ms<250,"SUSTAINED_HTTP_BUDGET");
      } catch(error) {timed.endedMs??=performance.now();timed.failure=(error as Error).message;throw error;} finally {save();}
    }
    const drain=performance.now();while(observations.some(row=>row.confirmedMs===null)&&performance.now()-drain<10000)await wait(25);
    observing=false;await Promise.all(observers);
    const summaries=[];for(const phase of ["sustained","burst"])for(const tab of [0,1])summaries.push({phase,tab,...reconcile(observations.filter(row=>row.tab===tab&&row.event.phase===phase),acceptance)});
    for(const runId of fixture.runs){
      const sequence=events.filter(event=>event.body.runId===runId).at(-1)!.body.sequence+1;
      const body={schemaVersion:1,eventId:randomUUID(),runId,sequence,type:"run.succeeded",occurredAt:new Date().toISOString(),payload:{summary:"Synthetic P07 load terminal outside timing"}};
      const response:Response=await fetch(server.url+`/api/v1/runs/${runId}/events`,{method:"POST",headers,body:JSON.stringify(body)});
      const ack=await response.json();result.final.push({body,digest:canonicalDigest(body),status:response.status,ack});assert.equal(response.status,201);eventResponse.parse(ack);
    }
    const api: (typeof eventsResponse)["_output"]["data"]["items"] = [];
    for(const runId of fixture.runs){let cursor:string|null=null;do{
      const response:Response=await fetch(server.url+`/api/v1/runs/${runId}/events?limit=100`+(cursor?`&cursor=${encodeURIComponent(cursor)}`:""),{headers});assert.equal(response.status,200);
      const page=eventsResponse.parse(await response.json());api.push(...page.data.items);cursor=page.data.nextCursor;
    }while(cursor);}
    assert.equal(api.length,events.length+counts.producers*2);
    const persisted=new Database(join(dir,"agentflow.sqlite"),{readonly:true});
    try {
      const actual=persisted.prepare("SELECT event_id,body,digest FROM run_events").all() as {event_id:string;body:string;digest:string}[];
      for(const request of result.requests){const row=actual.find(row=>row.event_id===request.eventId);assert(row,"PERSISTED_EVENT_MISSING");assert.equal(row.digest,request.digest);const {receivedAt,...input}=JSON.parse(row.body);assert.equal(canonicalDigest(input),request.digest);const ack=(request.ack as {data:{receivedAt:string}}).data;assert.equal(receivedAt,ack.receivedAt);const publicEvent=api.find(event=>event.eventId===request.eventId);assert(publicEvent,"PUBLIC_EVENT_MISSING");const {receivedAt:apiReceipt,...apiInput}=publicEvent;assert.equal(apiReceipt,receivedAt);assert.equal(canonicalDigest(apiInput),request.digest);}
      assert.equal(persisted.pragma("integrity_check",{simple:true}),"ok");assert.deepEqual(persisted.pragma("foreign_key_check"),[]);
      result.reconciliation={status:"finalized",expected:events.length,storedTimed:result.requests.length,apiCount:api.length,setupCount:result.setup.length,finalCount:result.final.length,summaries,burstPrecision:"four samples per full scenario/tab; nearest-rank p95 is maximum"};
    }finally{persisted.close();}
  }catch(error){result.failure=(error as Error).message;throw error;}
  finally{result.finishedMs=performance.now();save();observing=false;await Promise.allSettled(observers);await tabs?.browser.close();await server?.stop();save();}
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
