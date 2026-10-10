import {it,expect,vi,afterEach} from "vitest";
import {mkdtempSync,readFileSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const state=vi.hoisted(()=>({rows:[] as {event_id:string;run_id:string;sequence:number;body:string;digest:string;acknowledgement:string;received_at:number;occurred_at:number}[],closes:0,stops:0,apiCalls:0,mode:"success",readError:new Error("actual API body read error")}));
const generation="00000000-0000-4000-8000-000000000004",receipt="2026-10-10T00:00:00.000Z";
vi.mock("better-sqlite3",()=>({default:class{prepare(sql:string){return {get:()=>sql.includes("max(")?{latest:Date.now()-3600000}:sql.includes("generation")?{generation:"00000000-0000-4000-8000-000000000004"}:{n:sql.includes("tasks")?12:sql.includes("agents")?2:sql.includes("runs")?4:sql.includes("run_events")?108:sql.includes("projects")?1:250},all:()=>state.rows};}pragma(name:string){return name==="integrity_check"?"ok":[];}close(){}}}));
vi.mock("../fixtures/p06-performance",()=>({seedPerformance:async()=>({projectId:"00000000-0000-4000-8000-000000000001",runs:["00000000-0000-4000-8000-000000000002","00000000-0000-4000-8000-000000000003"]})}));
vi.mock("../fixtures/server",()=>({launch:async()=>({url:"http://127.0.0.1:1",credentials:()=>({reporterToken:"synthetic"}),stop:async()=>{state.stops++;}}),pair:async()=>"session=synthetic"}));
vi.mock("@playwright/test",()=>({chromium:{launch:async()=>({version:()=>"mock capture boundary",close:async()=>{state.closes++;},newContext:async()=>({route:async()=>{},addCookies:async()=>{},newPage:async()=>({goto:async()=>{},getByText:()=>({}),evaluate:async(input:unknown)=>typeof input==="function"?"visible":state.rows.some(row=>{const body=JSON.parse(row.body);return body.type==="run.progress"&&String(input).includes(JSON.stringify(body.payload.message));})?{receivedAt:"2026-10-10T00:00:00.000Z",twoFrames:true}:null})})})},expect:()=>({toBeVisible:async()=>{}})}));
import {canonicalDigest} from "../../src/domain/request-digest";
import {loadScenario} from "../fixtures/p07-load";
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it.each(["success","malformed","non200","read","changedBody","changedTime"])("actual post-timing caller retains original API/DB evidence mode=%s",async mode=>{
 vi.useFakeTimers({toFake:["setTimeout","clearTimeout","Date","performance"]});vi.setSystemTime(new Date(receipt));state.rows=[];state.closes=0;state.stops=0;state.apiCalls=0;state.mode=mode;
 const root=mkdtempSync(join(tmpdir(),"p07-load-capture-test-"));chmodSync(root,0o700);let firstApiAt:number|null=null,rawFirst:string|null=null;
 vi.stubGlobal("fetch",async(url:string,init?:{body:string})=>{
  if(init?.body){const body=JSON.parse(init.body),ack={data:{eventId:body.eventId,runId:body.runId,acceptedSequence:body.sequence,receivedAt:receipt},snapshotCursor:"0",generation};state.rows.push({event_id:body.eventId,run_id:body.runId,sequence:body.sequence,body:JSON.stringify({...body,receivedAt:receipt}),digest:canonicalDigest(body),acknowledgement:JSON.stringify(ack),received_at:Date.parse(receipt),occurred_at:Date.parse(body.occurredAt)});return {status:201,json:async()=>ack};}
  firstApiAt??=performance.now();const parsed=new URL(url),runId=parsed.pathname.split("/runs/")[1].split("/")[0],offset=Number(parsed.searchParams.get("cursor")??0),items=state.rows.filter(row=>row.run_id===runId).map(row=>JSON.parse(row.body));let status=200;
  if(state.apiCalls===0&&mode==="changedBody")items.find(item=>item.type==="run.progress").payload.message+=" changed";
  if(state.apiCalls===0&&mode==="changedTime")items.find(item=>item.sequence===2).receivedAt="2026-10-10T00:00:01.000Z";
  let raw=JSON.stringify({data:{items:items.slice(offset,offset+20),total:items.length,nextCursor:offset+20<items.length?String(offset+20):null},snapshotCursor:"0",generation});
  if(state.apiCalls===0&&mode==="malformed")raw="{original malformed API text";if(state.apiCalls===0&&mode==="non200"){status=503;raw="original unavailable API response";}
  const response=new Response(raw,{status,headers:{"agentflow-generation":generation}});if(state.apiCalls===0){rawFirst=mode==="read"?null:raw;if(mode==="read")response.text=async()=>{throw state.readError;};}state.apiCalls++;return response;
 });
 const work=loadScenario(root,0,false),settled=work.then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));await vi.advanceTimersByTimeAsync(10000);const outcome=await settled;
 expect(outcome.ok).toBe(mode==="success");if(mode==="read"&&!outcome.ok)expect(outcome.error).toBe(state.readError);
 const result=JSON.parse(readFileSync(join(root,"load-0.json"),"utf8"));expect(firstApiAt).toBe(9000);expect(result.phases.map((p:{endedMs:number})=>p.endedMs)).toEqual([6000,9000]);expect(state.closes).toBe(1);expect(state.stops).toBe(1);
 expect(result.postTiming.api[0]).toMatchObject({runId:"00000000-0000-4000-8000-000000000002",cursor:null,status:mode==="non200"?503:200,generation,text:rawFirst});
 expect(result.postTiming.database.rows).toHaveLength(88);expect(result.postTiming.database.counts.run_events).toBe(108);expect(result.postTiming.database.generation).toBe(generation);
 if(mode!=="success"){expect(result.reconciliation).toBeNull();if(["malformed","non200","read"].includes(mode))expect(result.postTiming.api[0].parsed).toBeNull();if(mode==="read")expect(result.postTiming.api[0].error.message).toBe(state.readError.message);}
 else{expect(result.postTiming.api.map((p:{cursor:string|null})=>p.cursor)).toEqual([null,"20","40",null,"20","40"]);const api=result.postTiming.api.flatMap((p:{text:string})=>JSON.parse(p.text).data.items);expect(api).toHaveLength(88);for(const row of result.postTiming.database.rows){const event=JSON.parse(row.body),{receivedAt,...body}=event;expect(canonicalDigest(body)).toBe(row.digest);expect(Date.parse(receivedAt)).toBe(row.received_at);expect(Date.parse(body.occurredAt)).toBe(row.occurred_at);expect(api.find((a:{eventId:string})=>a.eventId===event.eventId)).toEqual(event);expect(JSON.parse(row.acknowledgement).data.receivedAt).toBe(receivedAt);}}
});
