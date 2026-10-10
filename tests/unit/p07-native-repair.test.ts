import {it,expect,vi,afterEach} from "vitest";
const state=vi.hoisted(()=>({now:0,stops:0,launches:0,launchThrow:false,thrown:undefined as unknown,stopFails:false,bodyFails:false,writeFails:false,armed:false,error:new Error("first native body error"),io:new Error("native save ENOSPC"),stop:new Error("first stop error")}));
vi.mock("node:fs",async()=>({...await vi.importActual<typeof import("node:fs")>("node:fs"),cpSync:()=>{}}));
vi.mock("../fixtures/server",()=>({freePort:async()=>12345,launch:async()=>{state.launches++;if(state.launchThrow)throw state.thrown;return ({url:"http://127.0.0.1:12345",credentials:()=>({reporterToken:"synthetic"}),stop:async()=>{state.stops++;state.now+=20;if(state.stopFails&&state.stops===1)throw state.stop;}});}}));
vi.mock("../../src/contracts/responses",()=>({tasksResponse:{parse:(x:unknown)=>{state.now+=50;return x;}},taskDetailResponse:{parse:(x:unknown)=>{state.now+=50;return x;}},boardResponse:{parse:(x:unknown)=>{state.now+=50;return x;}},overviewResponse:{parse:(x:unknown)=>{state.now+=50;return x;}}}));
vi.mock("../../src/contracts/observations",()=>({eventResponse:{parse:(x:unknown)=>{state.now+=50;return x;}},eventsResponse:{parse:(x:unknown)=>{state.now+=50;return x;}}}));
vi.mock("../../src/contracts/tracking",()=>({trackingRunsResponse:{parse:(x:unknown)=>{state.now+=50;return x;}}}));
import {nativeCompare} from "../fixtures/p07-native";
import {ordinaryStages,ordinaryBoundary} from "../fixtures/p07-ordinary";
const seed={projectId:"synthetic",tasks:["synthetic-task"],runs:["00000000-0000-4000-8000-000000000001"],agents:[],historic:["synthetic-history"],qualification:"controlled native mock"};
function setup(){state.now=0;state.stops=0;state.launches=0;state.launchThrow=false;state.stopFails=false;state.bodyFails=false;state.writeFails=false;state.armed=false;vi.spyOn(performance,"now").mockImplementation(()=>state.now);const parse=JSON.parse;vi.spyOn(JSON,"parse").mockImplementation(text=>{state.now+=100;return parse(text);});vi.stubGlobal("fetch",async()=>({status:state.bodyFails?503:200,ok:!state.bodyFails,headers:new Headers({"agentflow-generation":"synthetic"}),json:async()=>{if(state.bodyFails){state.armed=true;throw state.error;}state.now+=300;return {};},text:async()=>{if(state.bodyFails){state.armed=true;throw state.error;}state.now+=200;return "{}";}}));}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it("actual native body failure retains status/request/end and attempts second stop despite firststop+save faults",async()=>{
 setup();state.bodyFails=true;state.stopFails=true;state.writeFails=true;const receipt={comparisons:[] as unknown[],failures:[] as string[]};
 await expect(nativeCompare({index:1,baseSource:"synthetic-base",seed,seedDir:"synthetic-seed",root:"synthetic-owned",counts:{samples:1,producers:1},acceptance:false,receipt,save:()=>{if(state.armed&&state.writeFails)throw state.io;}})).rejects.toBe(state.error);
 const result=receipt.comparisons[0] as {requests:{status:number;text:string|null}[];errors:number;measuredEndedMs:number|null;failure:string};expect(result.requests).toHaveLength(1);expect(result.requests[0].status).toBe(503);expect(result.requests[0].text).toBeNull();expect(result.errors).toBe(1);expect(result.measuredEndedMs).not.toBeNull();expect(state.stops).toBe(2);
});
it("actual native parse timing and budget gate stop actual ordinary seam before next comparison",async()=>{
 setup();const receipt={comparisons:[] as unknown[],failures:[] as string[]};let comparisons=0;
 // Successful status differs for paired ingestion versus reads, preserving the seven-operation path.
 vi.stubGlobal("fetch",async(_url:string,init:{method:string})=>({status:init.method==="POST"?201:200,ok:true,headers:new Headers({"agentflow-generation":"synthetic"}),json:async()=>{state.now+=300;return {};},text:async()=>{state.now+=200;return "{}";}}));
 await expect(ordinaryStages({repetitions:3,load:async()=>{},resource:async()=>{},flush:async()=>{},prepareNative:async()=>seed,compare:async index=>{comparisons++;await nativeCompare({index,baseSource:"synthetic-base",seed,seedDir:"synthetic-seed",root:"synthetic-owned",counts:{samples:1,producers:1},acceptance:true,receipt,save:()=>{}});}})).rejects.toThrow();
 expect(comparisons).toBe(1);const result=receipt.comparisons[0] as {requests:{ms:number}[]};expect(result.requests.every(row=>row.ms===300)).toBe(true);expect(receipt.failures).toHaveLength(7);
});
it("actual ordinary final save cannot suppress firsterror/failureexit/summary",async()=>{
 const primary=new Error("ordinary first work error"),io=new Error("ordinary final save error");let summary=0,exit=0,writes=0;
 await expect(ordinaryBoundary({failures:[]},async()=>{throw primary;},()=>{if(++writes>1)throw io;},()=>{summary++;},()=>{exit++;})).rejects.toBe(primary);expect(summary).toBe(1);expect(exit).toBeGreaterThan(0);
});

it.each([undefined,null,false,0])("actual native and ordinary preserve falsy first value %s",async primary=>{
 setup();state.launchThrow=true;state.thrown=primary;const receipt={comparisons:[] as unknown[],failures:[] as string[]};
 const native=await nativeCompare({index:1,baseSource:"synthetic",seed,seedDir:"synthetic",root:"synthetic",counts:{samples:1,producers:1},acceptance:false,receipt,save:()=>{}}).then(()=>({failed:false,value:null}),value=>({failed:true,value}));expect(native).toEqual({failed:true,value:primary});
 let summaries=0;const ordinary=await ordinaryBoundary({failures:[]},async()=>{throw primary;},()=>{},()=>{summaries++;},()=>{}).then(()=>({failed:false,value:null}),value=>({failed:true,value}));expect(ordinary).toEqual({failed:true,value:primary});expect(summaries).toBe(1);
});
it("actual native initial write failure leaves unstarted clocks/null distributions and launches no servers",async()=>{
 setup();const receipt={comparisons:[] as unknown[],failures:[] as string[]};await expect(nativeCompare({index:1,baseSource:"synthetic",seed,seedDir:"synthetic",root:"synthetic",counts:{samples:1,producers:1},acceptance:false,receipt,save:()=>{throw state.io;}})).rejects.toBe(state.io);
 const result=receipt.comparisons[0] as {measuredStartedMs:number|null;measuredEndedMs:number|null;operations:Record<string,{base:{count:number;p95Ms:number|null}}>} ;expect(state.launches).toBe(0);expect([result.measuredStartedMs,result.measuredEndedMs]).toEqual([null,null]);expect(Object.values(result.operations).every(row=>row.base.count===0&&row.base.p95Ms===null)).toBe(true);
});
it("actual ordinary initial write aborts work but final summary remains reachable",async()=>{
 let work=0,summary=0,exit=0;const io=new Error("initial save IO");await expect(ordinaryBoundary({failures:[]},async()=>{work++;},()=>{throw io;},()=>{summary++;},()=>{exit++;})).rejects.toBe(io);expect(work).toBe(0);expect(summary).toBe(1);expect(exit).toBeGreaterThan(0);
});

it("actual native success keeps accepted counts and JSONparse timing before schema work",async()=>{
 setup();const receipt={comparisons:[] as unknown[],failures:[] as string[]};vi.stubGlobal("fetch",async(_url:string,init:{method:string})=>({status:init.method==="POST"?201:200,ok:true,headers:new Headers({"agentflow-generation":"known header"}),text:async()=>{state.now+=200;return "{}";}}));
 await nativeCompare({index:1,baseSource:"synthetic",seed,seedDir:"synthetic",root:"synthetic",counts:{samples:1,producers:1},acceptance:false,receipt,save:()=>{}});
 const result=receipt.comparisons[0] as {status:string;requests:{ms:number;warmup:boolean}[];operations:Record<string,{base:{count:number};head:{count:number}}>};expect(result.status).toBe("finalized");expect(result.requests).toHaveLength(154);expect(result.requests.filter(row=>!row.warmup)).toHaveLength(14);expect(result.requests.every(row=>row.ms===300)).toBe(true);expect(Object.values(result.operations).every(row=>row.base.count===1&&row.head.count===1)).toBe(true);expect(state.stops).toBe(2);
});
it("actual ordinary/native nesting retains work error despite native persistence failure and still summarizes",async()=>{
 setup();state.bodyFails=true;state.stopFails=true;const receipt={comparisons:[] as unknown[],failures:[] as string[]};let summary=0,exit=0;const write=()=>{if(state.armed)throw state.io;};
 await expect(ordinaryBoundary(receipt,async()=>{await ordinaryStages({repetitions:3,load:async()=>{},resource:async()=>{},flush:async()=>{},prepareNative:async()=>seed,compare:async index=>{await nativeCompare({index,baseSource:"synthetic",seed,seedDir:"synthetic",root:"synthetic",counts:{samples:1,producers:1},acceptance:false,receipt,save:write});}});},write,()=>{summary++;},()=>{exit++;})).rejects.toBe(state.error);expect(summary).toBe(1);expect(exit).toBeGreaterThan(0);expect(receipt.comparisons).toHaveLength(1);expect(state.stops).toBe(2);
});
