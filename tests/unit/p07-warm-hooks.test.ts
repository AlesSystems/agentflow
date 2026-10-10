import {it,expect,vi,afterEach} from "vitest";
import {mkdtempSync,readFileSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const seam=vi.hoisted(()=>({stops:0,closes:0,fetches:[] as number[],closeFails:false,rows:[] as {event_id:string;body:string;digest:string}[]}));
vi.mock("better-sqlite3",()=>({default:class{prepare(){return {get:()=>({latest:Date.now()-3600000}),all:()=>seam.rows};}pragma(name:string){return name==="integrity_check"?"ok":[];}close(){}}}));
vi.mock("../fixtures/p06-performance",()=>({seedPerformance:async()=>({projectId:"00000000-0000-4000-8000-000000000001",runs:["00000000-0000-4000-8000-000000000002","00000000-0000-4000-8000-000000000003"]})}));
vi.mock("../fixtures/server",()=>({launch:async()=>({url:"http://127.0.0.1:1",credentials:()=>({reporterToken:"synthetic"}),stop:async()=>{seam.stops++;}}),pair:async()=>"session=synthetic"}));
vi.mock("@playwright/test",()=>({chromium:{launch:async()=>({version:()=>"mock boundary",close:async()=>{seam.closes++;if(seam.closeFails)throw new Error("browser cleanup failure");},newContext:async()=>({route:async()=>{},addCookies:async()=>{},newPage:async()=>({goto:async()=>{},getByText:()=>({}),evaluate:async(input:unknown)=>typeof input==="function"?"visible":seam.rows.some(row=>{const body=JSON.parse(row.body);return body.type==="run.progress"&&String(input).includes(JSON.stringify(body.payload.message));})?{receivedAt:"2026-10-10T00:00:00.000Z",twoFrames:true}:null})})})},expect:()=>({toBeVisible:async()=>{}})}));
import {canonicalDigest} from "../../src/domain/request-digest";
import {loadScenario,type LoadHooks} from "../fixtures/p07-load";
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();seam.closeFails=false;seam.rows=[];});
it("actual optional load caller retains first dispatch failure before failing profiler cleanup and remaining teardown",async()=>{
 const root=mkdtempSync(join(tmpdir(),"p07-warm-hook-test-"));chmodSync(root,0o700);seam.stops=0;seam.closes=0;seam.fetches=[];seam.closeFails=true;
 vi.stubGlobal("fetch",async(_url:string,init:{body:string})=>{const body=JSON.parse(init.body);seam.fetches.push(body.sequence);if(body.sequence>1)throw new Error("actual transport boundary failure");return {status:201,json:async()=>({data:{eventId:body.eventId,runId:body.runId,acceptedSequence:body.sequence,receivedAt:"2026-10-10T00:00:00.000Z"},snapshotCursor:"0",generation:"00000000-0000-4000-8000-000000000004"})};});
 let started=0,phase=0,inspected=false,remaining=false;
 const hooks:LoadHooks={start:async()=>{started++;},phase:()=>{phase++;},cleanup:()=>[["failing profile",async()=>{const x=JSON.parse(readFileSync(join(root,"load-0.json"),"utf8"));expect(x.failure).toBe("actual transport boundary failure");expect(x.requests.length).toBe(2);expect(x.phases[0].endedMs).toBeTypeOf("number");expect(x.requests.every((r:{dispatchMs:number})=>typeof r.dispatchMs==="number")).toBe(true);inspected=true;throw new Error("profile stop boundary failure");}],["remaining profile",async()=>{remaining=true;}]]};
 await expect(loadScenario(root,0,false,hooks)).rejects.toThrow("actual transport boundary failure");
 expect({started,phase,inspected,remaining,stops:seam.stops,closes:seam.closes}).toEqual({started:1,phase:1,inspected:true,remaining:true,stops:1,closes:1});
 const x=JSON.parse(readFileSync(join(root,"load-0.json"),"utf8"));expect(x.diagnostic.profileCleanup.failures[0].error).toBe("profile stop boundary failure");expect(x.diagnostic.cleanup.failures[0].error).toBe("browser cleanup failure");expect(seam.fetches).toEqual([1,1,2,2]);
});

it("actual caller retains failed profiling-start duration before cleanup without timed dispatch",async()=>{
 const root=mkdtempSync(join(tmpdir(),"p07-warm-start-test-"));chmodSync(root,0o700);seam.stops=0;seam.closes=0;seam.fetches=[];
 vi.stubGlobal("fetch",async(_url:string,init:{body:string})=>{const body=JSON.parse(init.body);seam.fetches.push(body.sequence);return {status:201,json:async()=>({data:{eventId:body.eventId,runId:body.runId,acceptedSequence:body.sequence,receivedAt:"2026-10-10T00:00:00.000Z"},snapshotCursor:"0",generation:"00000000-0000-4000-8000-000000000004"})};});
 let inspected=false;
 await expect(loadScenario(root,0,false,{start:async()=>{throw new Error("profiling start failure");},cleanup:()=>[["inspect partial start",async()=>{const x=JSON.parse(readFileSync(join(root,"load-0.json"),"utf8"));expect(x.diagnostic.start.endedMs).toBeTypeOf("number");expect(x.requests).toHaveLength(0);expect(x.phases).toHaveLength(0);expect(x.failure).toBe("profiling start failure");inspected=true;}]]})).rejects.toThrow("profiling start failure");
 expect(inspected).toBe(true);expect(seam.fetches).toEqual([1,1]);expect(seam.stops).toBe(1);expect(seam.closes).toBe(1);
});

it.each([false,true,"cadence"] as const)("same caller virtual-clock default/optional path preserves both phase schedules (hooks=%s)",async optional=>{
 vi.useFakeTimers({toFake:["setTimeout","clearTimeout","Date","performance"]});vi.setSystemTime(new Date("2026-10-10T00:00:00.000Z"));
 const root=mkdtempSync(join(tmpdir(),"p07-warm-virtual-test-"));chmodSync(root,0o700);seam.rows=[];
 vi.stubGlobal("fetch",async(url:string,init?:{body:string})=>{if(!init?.body){const runId=url.split("/runs/")[1].split("/")[0];const items=seam.rows.map(row=>JSON.parse(row.body)).filter(body=>body.runId===runId);return {status:200,json:async()=>({data:{items,total:items.length,nextCursor:null},snapshotCursor:"0",generation:"00000000-0000-4000-8000-000000000004"})};}const body=JSON.parse(init.body);if(optional==="cadence"&&body.sequence===14)await new Promise(resolve=>setTimeout(resolve,200));seam.rows.push({event_id:body.eventId,body:JSON.stringify({...body,receivedAt:"2026-10-10T00:00:00.000Z"}),digest:canonicalDigest(body)});return {status:201,json:async()=>({data:{eventId:body.eventId,runId:body.runId,acceptedSequence:body.sequence,receivedAt:"2026-10-10T00:00:00.000Z"},snapshotCursor:"0",generation:"00000000-0000-4000-8000-000000000004"})};});
 const calls:string[]=[];const work=loadScenario(root,0,false,optional?{start:async()=>{calls.push("start");},phase:phase=>calls.push(phase),cleanup:()=>[["profile stop",async()=>{const x=JSON.parse(readFileSync(join(root,"load-0.json"),"utf8"));expect(x.phases.map((p:{endedMs:number})=>p.endedMs)).toEqual([6000,9000]);if(optional==="cadence"){expect(x.phases[1].http.count).toBe(60);expect(x.failure).toContain("MISSED_SLOT");}calls.push("stop");}]]}:undefined);
 const settled=work.then(x=>({ok:true as const,x}),error=>({ok:false as const,error}));
 await vi.advanceTimersByTimeAsync(10000);const outcome=await settled;if(!outcome.ok&&optional!=="cadence")throw outcome.error;const x=outcome.ok?outcome.x:JSON.parse(readFileSync(join(root,"load-0.json"),"utf8"));
 if(optional==="cadence"){expect(outcome.ok).toBe(false);expect(x.failure).toContain("MISSED_SLOT");expect(x.phases[1].http.count).toBe(60);expect(x.diagnostic.profileCleanup.failures).toEqual([]);}
 expect(x.requests).toHaveLength(84);expect(x.requests.filter((row:{dueMs:number})=>row.dueMs===0).map((row:{dispatchMs:number})=>row.dispatchMs)).toEqual([0,0,6000,6000]);if(optional!=="cadence")expect(x.failure).toBeNull();expect(calls).toEqual(optional?["start","sustained","burst","stop"]:[]);
});
