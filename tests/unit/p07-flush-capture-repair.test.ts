import {it,expect,vi} from "vitest";
const state=vi.hoisted(()=>({mode:"query",primary:new Error("later agents query error"),body:new Error("actual body read error")}));
vi.mock("better-sqlite3",()=>({default:class{prepare(sql:string){return {get:()=>{if(sql.includes("generation"))return {generation:"00000000-0000-4000-8000-000000000001"};if(state.mode==="query"&&sql.includes("agents"))throw state.primary;return {n:1};},all:()=>[{event_id:"synthetic returned row"}]};}pragma(){return [];}close(){}}}));
vi.mock("node:fs",async()=>({...await vi.importActual<typeof import("node:fs")>("node:fs"),readdirSync:()=>[]}));
import {collectFlush,type FlushFacts} from "../fixtures/p07-flush";
it.each(["query","body","parse"])("actual flush capture retains earlier sections and collection error for %s",async mode=>{
 state.mode=mode;const facts:FlushFacts={expected:{tasks:1,events:0,producers:1,queued:1,runs:["00000000-0000-4000-8000-000000000001"]},queued:[],attempts:[],stdout:[],generation:null,database:null,pages:[],files:[]};
 vi.stubGlobal("fetch",async()=>({status:mode==="body"?503:200,headers:new Headers({"agentflow-generation":"known current header"}),text:async()=>{if(mode==="body")throw state.body;return "{original malformed text";}}));
 const outcome=await collectFlush(facts,"synthetic-owned","synthetic-outbox",{url:"http://127.0.0.1:1",credentials:()=>({reporterToken:"synthetic"})} as Parameters<typeof collectFlush>[3]).then(()=>({failed:false,value:null}),value=>({failed:true,value}));
 expect(outcome.failed).toBe(true);expect(facts.database!.rows).toHaveLength(1);
 if(mode==="query"){expect(outcome.value).toBe(state.primary);expect(facts.database!.counts).toMatchObject({tasks:1,agents:null});expect(facts.database!.error?.message).toBe(state.primary.message);expect(facts.pages).toEqual([]);}else{expect(facts.pages).toHaveLength(1);expect(facts.pages[0]).toMatchObject({runId:facts.expected.runs[0],cursor:null,status:mode==="body"?503:200,generation:"known current header",raw:mode==="body"?null:"{original malformed text",parsed:null});expect(facts.pages[0].error).not.toBeNull();if(mode==="body")expect(outcome.value).toBe(state.body);}
 vi.unstubAllGlobals();
});
