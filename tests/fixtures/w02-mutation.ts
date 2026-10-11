import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { boundedFetch,readBoundedText } from "./w01-runtime";
export type Pacing={requestedMs:number;readyMs:number;waitedMs:number;completedMs:number|null;nextAllowedMs:number|null;ordinal:number};
export type MutationGate=ReturnType<typeof mutationGate>;
export function mutationGate(clock={now:()=>performance.now(),sleep:(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))}){
 let tail=Promise.resolve(),nextAllowed=0,ordinal=0;
 async function run<T>(work:()=>Promise<T>,capture:(pacing:Pacing)=>void=()=>{}){const requestedMs=clock.now(),prior=tail;let release!:()=>void;tail=new Promise<void>(resolve=>{release=resolve;});await prior;
  while(clock.now()<nextAllowed)await clock.sleep(Math.max(1,Math.ceil(nextAllowed-clock.now())));const readyMs=clock.now(),pacing:Pacing={requestedMs,readyMs,waitedMs:readyMs-requestedMs,completedMs:null,nextAllowedMs:null,ordinal:++ordinal};
  try{capture(pacing);return await work();}finally{pacing.completedMs=clock.now();nextAllowed=pacing.completedMs+15;pacing.nextAllowedMs=nextAllowed;release();}
 }
 return {run};
}
export type HttpFact={id:string;parentSampleId:string;setup:boolean;warmup:boolean;label:string;dataDir:string;operation:string;method:string;path:string;input:unknown;body:string|null;key:string|null;status:number|null;generation:string|null;retryAfter:string|null;text:string|null;failure:string|null;persistenceFailure:string|null;dispatchMs:number|null;drainedMs:number|null;elapsedMs:number|null;pacing?:Pacing};
export function httpFact(identity:Pick<HttpFact,"id"|"parentSampleId"|"setup"|"warmup"|"label"|"dataDir"|"operation">):HttpFact{return {...identity,method:"",path:"",input:null,body:null,key:null,status:null,generation:null,retryAfter:null,text:null,failure:null,persistenceFailure:null,dispatchMs:null,drainedMs:null,elapsedMs:null};}
export async function capturedHttp(url:string,input:unknown,method:string,headers:Record<string,string>,record:HttpFact,save:()=>void,gate:MutationGate){
 const body=input===undefined?null:JSON.stringify(input),key=body===null?null:randomUUID();Object.assign(record,{method,path:new URL(url).pathname+(new URL(url).search??""),body,input:body===null?null:JSON.parse(body),key});const requestHeaders={...headers,...(body===null?{}:{"Content-Type":"application/json","Idempotency-Key":key!})};
 try{save();}catch(error){record.failure=String(error);record.persistenceFailure=String(error);throw error;}const send=async()=>{record.dispatchMs=performance.now();try{const response=await boundedFetch(url,{method,headers:requestHeaders,body:body??undefined});Object.assign(record,{status:response.status,generation:response.headers.get("AgentFlow-Generation"),retryAfter:response.headers.get("Retry-After")});record.text=await readBoundedText(response,text=>{record.text=text;});record.drainedMs=performance.now();if(!response.ok)throw Error(`HTTP ${response.status} ${method} ${record.path}: ${record.text}`);return JSON.parse(record.text);
 }catch(error){record.failure=String(error);throw error;}finally{record.drainedMs??=performance.now();record.elapsedMs=record.drainedMs-record.dispatchMs;try{save();}catch(error){record.persistenceFailure=String(error);if(record.failure===null)throw error;}}};
 return method==="GET"||method==="HEAD"?send():gate.run(send,pacing=>{record.pacing=pacing;});
}
export function assertPacing(facts:HttpFact[]){const mutations=facts.filter(f=>f.method!=="GET"&&f.method!=="HEAD");for(let index=1;index<mutations.length;index++){const previous=mutations[index-1],current=mutations[index];assert(previous.drainedMs!==null&&current.dispatchMs!==null&&current.dispatchMs-previous.drainedMs>=15-0.001,"mutation cooldown missing");}}
