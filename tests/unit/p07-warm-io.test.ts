import {it,expect,vi,afterEach} from "vitest";
import {mkdtempSync,readFileSync,existsSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const state=vi.hoisted(()=>({writes:0,persistent:false,armed:false,kind:"",stage:"any",seen:0,error:Object.assign(new Error("injected artifact ENOSPC"),{code:"ENOSPC"}),disconnected:0,calls:[] as string[],stops:0,closes:0}));
vi.mock("node:fs",async()=>{const actual=await vi.importActual<typeof import("node:fs")>("node:fs");return {...actual,writeFileSync:(path:import("node:fs").PathOrFileDescriptor,...args:unknown[])=>{if(state.armed&&((state.kind==="profile"&&String(path).includes("cpu.json"))||(state.kind==="entry"&&String(path).endsWith("first-error.txt"))||(state.kind==="load"&&String(path).endsWith("load-0.json")))){let selected=true;if(state.kind==="load"&&state.stage!=="any"){const facts=JSON.parse(String(args[0]));if(state.stage==="phaseStart")selected=facts.phases.length===1&&facts.phases[0].endedMs===null&&facts.requests.length===0;else if(state.stage==="finishProfile")selected=facts.finishedMs!==null&&facts.diagnostic?.profileCleanup===null&&++state.seen===2;else if(state.stage==="outer")selected=facts.finishedMs!==null&&facts.diagnostic?.profileCleanup===null;}
 if(selected){state.writes++;if(state.persistent||state.writes===1)throw state.error;}}return (actual.writeFileSync as (...args:unknown[])=>void)(path,...args);}};});
vi.mock("node:inspector",()=>({Session:class{connect(){}disconnect(){state.disconnected++;}post(method:string,callback:(error:null,result:unknown)=>void){state.calls.push(method);callback(null,{profile:{nodes:[],samples:[]}});}}}));
vi.mock("better-sqlite3",()=>({default:class{prepare(){return {get:()=>({latest:Date.now()-3600000})};}close(){}}}));
vi.mock("../fixtures/p06-performance",()=>({seedPerformance:async()=>({projectId:"00000000-0000-4000-8000-000000000001",runs:["00000000-0000-4000-8000-000000000002","00000000-0000-4000-8000-000000000003"]})}));
vi.mock("../fixtures/server",()=>({launch:async()=>({url:"http://127.0.0.1:1",credentials:()=>({reporterToken:"synthetic"}),stop:async()=>{state.stops++;}}),pair:async()=>"session=synthetic"}));
vi.mock("@playwright/test",()=>({chromium:{launch:async()=>({version:()=>"mock IO boundary",close:async()=>{state.closes++;},newContext:async()=>({route:async()=>{},addCookies:async()=>{},newPage:async()=>({goto:async()=>{},getByText:()=>({}),evaluate:async(input:unknown)=>typeof input==="function"?"visible":null})})})},expect:()=>({toBeVisible:async()=>{}})}));
import {profile} from "../fixtures/p07-diagnostic-profile";
import {loadScenario} from "../fixtures/p07-load";
import {reportWarmFailure} from "../fixtures/p07-warm-error";
function setup(kind:string,persistent:boolean){state.kind=kind;state.stage="any";state.seen=0;state.persistent=persistent;state.armed=false;state.writes=0;state.calls=[];state.disconnected=0;state.stops=0;state.closes=0;const root=mkdtempSync(join(tmpdir(),"p07-warm-io-test-"));chmodSync(root,0o700);return root;}
it.each([false,true])("actual profiler finalization attempts CPUstop/disconnect despite write failure persistent=%s",async persistent=>{
 const root=setup("profile",persistent),path=join(root,"cpu.json");const finish=await profile(path);state.armed=true;
 await expect(finish()).rejects.toBe(state.error);expect(state.calls).toContain("Profiler.stop");expect(state.disconnected).toBe(1);
 expect(existsSync(path+".partial.json")).toBe(false);if(!persistent){const facts=JSON.parse(readFileSync(path,"utf8"));expect(facts.errors[0].action).toBe("partial write");}else expect(existsSync(path)).toBe(false);
 state.armed=false;
});
it.each([false,true])("actual optional caller keeps transport identity and all cleanup under receipt write faults persistent=%s",async persistent=>{
 const root=setup("load",persistent),primary=new Error("actual first transport error");let first=0,second=0,end:number|null=null;
 vi.stubGlobal("fetch",async(_url:string,init:{body:string})=>{const body=JSON.parse(init.body);if(body.sequence>1){state.armed=true;throw primary;}return {status:201,json:async()=>({data:{eventId:body.eventId,runId:body.runId,acceptedSequence:body.sequence,receivedAt:"2026-10-10T00:00:00.000Z"},snapshotCursor:"0",generation:"00000000-0000-4000-8000-000000000004"})};});
 await expect(loadScenario(root,0,false,{cleanup:()=>[["first profile",async()=>{first++;end=(primary as Error&{loadFacts:{phases:{endedMs:number}[]}}).loadFacts.phases[0].endedMs;}],["second profile",async()=>{second++;}]]})).rejects.toBe(primary);
 expect({first,second,close:state.closes,stop:state.stops}).toEqual({first:1,second:1,close:1,stop:1});expect(end).toBeTypeOf("number");
 const snapshot=JSON.parse(readFileSync(join(root,"load-0.json"),"utf8"));if(persistent){expect(snapshot.requests).toHaveLength(0);expect(snapshot.reconciliation).toBeNull();}else{expect(snapshot.failure).toBe(primary.message);expect(snapshot.requests).toHaveLength(2);expect(snapshot.retention.saveFailures.length).toBeGreaterThan(0);expect(snapshot.phases[0].endedMs).toBe(end);}
 state.armed=false;vi.unstubAllGlobals();
});
afterEach(()=>{state.armed=false;vi.unstubAllGlobals();});
it.each([false,true])("actual entry reports original error and failure exit even when first-error artifact fails persistent=%s",persistent=>{
 const root=setup("entry",persistent),primary=new Error("first actual load error");state.armed=true;let exit=0,reported:unknown,secondary:unknown;
 expect(()=>reportWarmFailure(primary,join(root,"first-error.txt"),{exit:()=>{exit++;},primary:error=>{reported=error;},secondary:error=>{secondary=error;}})).not.toThrow();expect(exit).toBe(1);expect(reported).toBe(primary);expect(secondary).toBe(state.error);expect(existsSync(join(root,"first-error.txt"))).toBe(false);state.armed=false;
});

it.each(["start","finishProfile","outer","phaseStart","default"])("actual caller guards %s persistence boundary and preserves first value",async boundary=>{
 const root=setup("load",false);state.stage=boundary==="phaseStart"?"phaseStart":boundary==="finishProfile"?"finishProfile":boundary==="outer"?"outer":"any";
 const primary=boundary==="phaseStart"?state.error:new Error("first "+boundary+" error");let dispatches=0,first=0,second=0,end:number|null=null;
 vi.stubGlobal("fetch",async(_url:string,init:{body:string})=>{const body=JSON.parse(init.body);if(body.sequence>1){dispatches++;state.armed=true;throw primary;}return {status:201,json:async()=>({data:{eventId:body.eventId,runId:body.runId,acceptedSequence:body.sequence,receivedAt:"2026-10-10T00:00:00.000Z"},snapshotCursor:"0",generation:"00000000-0000-4000-8000-000000000004"})};});
 if(boundary==="phaseStart")state.armed=true;
 const facts=()=> (primary as Error&{loadFacts:{phases:{endedMs:number}[];diagnostic:{start:{endedMs:number}}}}).loadFacts;
 const hooks=boundary==="default"?undefined:{start:async()=>{if(boundary==="start"){state.armed=true;throw primary;}},cleanup:()=>[["first profile",async()=>{first++;end=facts().phases[0]?.endedMs??null;}],["second profile",async()=>{second++;}]] as [string,()=>Promise<void>][]};
 await expect(loadScenario(root,0,false,hooks)).rejects.toBe(primary);
 expect(state.closes).toBe(1);expect(state.stops).toBe(1);expect([first,second]).toEqual(boundary==="default"?[0,0]:[1,1]);
 const saved=JSON.parse(readFileSync(join(root,"load-0.json"),"utf8"));expect(saved.failure).toBe(primary.message);expect(saved.retention.saveFailures).toHaveLength(1);expect(saved.reconciliation).toBeNull();
 if(boundary==="start"){expect(saved.phases).toHaveLength(0);expect(saved.diagnostic.start.endedMs).toBeTypeOf("number");expect(dispatches).toBe(0);}else{expect(saved.phases[0].endedMs).toBeTypeOf("number");if(boundary!=="default")expect(saved.phases[0].endedMs).toBe(end);}
 if(boundary==="phaseStart")expect(dispatches).toBe(0);
});
it("actual caller survives actual profiler artifact failure and still stops inspector and remaining resources",async()=>{
 const root=setup("profile",true),primary=new Error("first connected transport error"),finish=await profile(join(root,"cpu.json"));let second=0;
 vi.stubGlobal("fetch",async(_url:string,init:{body:string})=>{const body=JSON.parse(init.body);if(body.sequence>1){state.armed=true;throw primary;}return {status:201,json:async()=>({data:{eventId:body.eventId,runId:body.runId,acceptedSequence:body.sequence,receivedAt:"2026-10-10T00:00:00.000Z"},snapshotCursor:"0",generation:"00000000-0000-4000-8000-000000000004"})};});
 await expect(loadScenario(root,0,false,{cleanup:()=>[["actual profiler",async()=>{await finish();}],["second profile",async()=>{second++;}]]})).rejects.toBe(primary);
 expect(state.calls).toContain("Profiler.stop");expect(state.disconnected).toBe(1);expect(second).toBe(1);expect(state.closes).toBe(1);expect(state.stops).toBe(1);const saved=JSON.parse(readFileSync(join(root,"load-0.json"),"utf8"));expect(saved.diagnostic.profileCleanup.failures[0].error).toBe(state.error.message);expect(saved.failure).toBe(primary.message);expect(saved.diagnostic.profileCleanup.failures[0].facts.anchor.monotonicMs).toBeTypeOf("number");expect(saved.diagnostic.profileCleanup.failures[0].facts.cpu).not.toBeNull();
});
