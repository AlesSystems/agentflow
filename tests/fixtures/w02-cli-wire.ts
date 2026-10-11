import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Reply } from "./p06-proxy";
import { captureEventSpool,validateEventSpool } from "./w01-spool";
import { validateGeneration } from "./w02-measurement";
export type WireAttempt={id:string;parentSampleId:string;source:string;dataDir:string;setup:boolean;context:number[];method:string;path:string;key:string|null;body:string|null;input:unknown;preference:string|null;spool:unknown;requestHeaders:Record<string,string|string[]|undefined>;status:number|null;text:string|null;generation:string|null;retryAfter:string|null;responseHeaders:Record<string,string>|null;dispatchMs:number;drainedMs:number|null;failure:string|null;persistenceFailure:string|null;intentionalOutage:boolean};
export type CliWireFact={id:string;parentSampleId:string;source:string;dataDir:string;setup:boolean;context:number[];attempts:WireAttempt[];failure:string|null;persistenceFailure:string|null;intentionalOutage?:boolean};
export function cliWireCapture(active:()=>CliWireFact|undefined,outbox:string,save:()=>void){
 const requests=new WeakMap<IncomingMessage,{target:CliWireFact;attempt:WireAttempt}>();let fenced=false;
 function latch(target:CliWireFact,attempt:WireAttempt,error:unknown,persist=false){attempt.failure??=String(error);target.failure??=String(error);if(persist){attempt.persistenceFailure??=String(error);target.persistenceFailure??=String(error);fenced=true;}}
 function persist(target:CliWireFact,attempt:WireAttempt){try{save();return true;}catch(error){latch(target,attempt,error,true);try{save();}catch{}return false;}}
 function replyFacts(attempt:WireAttempt,reply:Reply){Object.assign(attempt,{status:reply.status,text:reply.body.toString(),generation:reply.generation,retryAfter:reply.retryAfter,responseHeaders:{...reply.headers},drainedMs:performance.now()});}
 function decide(request:IncomingMessage,body:Buffer,reply?:Reply){
  if(!reply){const target=active();if(!target)return undefined;const attempt:WireAttempt={id:target.id+":attempt:"+target.attempts.length,parentSampleId:target.parentSampleId,source:target.source,dataDir:target.dataDir,setup:target.setup,context:[...target.context],method:request.method??"GET",path:request.url??"",key:typeof request.headers["idempotency-key"]==="string"?request.headers["idempotency-key"]:null,body:body.length?body.toString():null,input:null,preference:typeof request.headers.prefer==="string"?request.headers.prefer:null,spool:null,requestHeaders:Object.fromEntries(Object.entries(request.headers).filter(([name])=>name!=="authorization")),status:null,text:null,generation:null,retryAfter:null,responseHeaders:null,dispatchMs:performance.now(),drainedMs:null,failure:null,persistenceFailure:null,intentionalOutage:target.setup&&target.intentionalOutage===true&&request.method==="POST"};target.attempts.push(attempt);requests.set(request,{target,attempt});
   try{assert(!fenced,"CLI original capture fenced");if(attempt.body!==null)attempt.input=JSON.parse(attempt.body);if(attempt.method==="POST"){if(attempt.path.endsWith("/events")){const input=attempt.input as {runId:string;sequence:number;eventId:string};attempt.spool=captureEventSpool(outbox,{kind:"run",id:input.runId},input);validateEventSpool(attempt.spool as ReturnType<typeof captureEventSpool>,input);}else{const bytes=readFileSync(join(outbox,`registration-${attempt.key}.json`));attempt.spool={originalBytesBase64:bytes.toString("base64"),record:JSON.parse(bytes.toString())};}}}catch(error){latch(target,attempt,error);fenced=true;persist(target,attempt);return {drop:true as const};}
   if(!persist(target,attempt))return {drop:true as const};
   if(attempt.intentionalOutage){const text=JSON.stringify({error:{code:"synthetic_queue_control",message:"Synthetic queue before measurement"}});replyFacts(attempt,{status:503,body:Buffer.from(text),generation:null,retryAfter:null,headers:{}});if(!persist(target,attempt))return {drop:true as const};return {status:503,body:text};}return undefined;
  }
  const captured=requests.get(request);if(!captured)return undefined;const {target,attempt}=captured;replyFacts(attempt,reply);if(reply.status<200||reply.status>=300)latch(target,attempt,Error(`HTTP ${reply.status} ${attempt.method} ${attempt.path}: ${attempt.text}`));else try{validateGeneration(attempt.generation,JSON.parse(attempt.text!));}catch(error){latch(target,attempt,error);fenced=true;}if(!persist(target,attempt))return {drop:true as const};return undefined;
 }
 function onFailure(request:IncomingMessage,error:unknown,reply?:Reply){const captured=requests.get(request);if(!captured)return;const {target,attempt}=captured;if(reply)replyFacts(attempt,reply);attempt.drainedMs??=performance.now();latch(target,attempt,error);persist(target,attempt);}
 return {decide,onFailure};
}
export function validateCliWire(fact:CliWireFact){assert(!fact.failure&&!fact.persistenceFailure,"CLI logical sample permanently failed: "+fact.failure);assert(fact.attempts.length>0,"missing CLI original attempts");for(const a of fact.attempts)assert(!a.failure&&!a.persistenceFailure&&a.status!==null&&(a.intentionalOutage?a.status===503:a.status>=200&&a.status<300),"CLI attempt failed");}

export function persistCliWire(fact:CliWireFact,save:()=>void){try{save();}catch(error){fact.failure??=String(error);fact.persistenceFailure??=String(error);try{save();}catch{}throw error;}}
