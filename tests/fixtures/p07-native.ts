import {proofErrors} from "./p07-proof-errors";
import {failureFact} from "./p07-warm-error";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {cpSync} from "node:fs";
import {join} from "node:path";
import {z} from "zod";
import {canonicalDigest} from "../../src/domain/request-digest";
import {taskDetailResponse,tasksResponse,boardResponse,overviewResponse} from "../../src/contracts/responses";
import {eventResponse,eventsResponse} from "../../src/contracts/observations";
import {trackingRunsResponse} from "../../src/contracts/tracking";
import {launch,freePort} from "./server";
import type {seedPerformance} from "./p06-performance";
export type NativeOptions={index:number;baseSource:string;seed:Awaited<ReturnType<typeof seedPerformance>>;seedDir:string;root:string;counts:{samples:number;producers:number};acceptance:boolean;receipt:{comparisons:unknown[];failures:string[]};save:()=>void};
function distribution(samples: number[]) {
  if(!samples.length)return {count:0,p50Ms:null,p95Ms:null,maxMs:null,samplesMs:samples};
  const sorted = [...samples].sort((a,b) => a-b);
  return { count: samples.length, p50Ms: sorted[Math.ceil(sorted.length*.5)-1], p95Ms: sorted[Math.ceil(sorted.length*.95)-1], maxMs: sorted.at(-1)!, samplesMs: samples };
}
export async function nativeCompare(options:NativeOptions) {
  const {index,baseSource,seed,seedDir,root,counts,acceptance,receipt,save}=options;
  const labels = index % 2 ? ["base","head"] as const : ["head","base"] as const;
  const servers: Partial<Record<"base"|"head", Awaited<ReturnType<typeof launch>>>> = {};
  const operations: Record<string,{base:number[];head:number[]}> = Object.fromEntries(["ingestion","tasks","detail","board","overview","tracking","events"].map(name=>[name,{base:[],head:[]} ]));
  const result = { index, status:"unfinalized",measuredStartedMs:null as number|null, measuredEndedMs: null as number|null, order: labels, requests: [] as {label:string;operation:string;ordinal:number;warmup:boolean;dispatchMs:number;status:number|null;generation:string|null;text:string|null;response:unknown;responseMs:number|null;failedMs:number|null;ms:number|null;error:ReturnType<typeof failureFact>|null;input:unknown;eventId?:string;digest?:string}[], operations: {} as Record<string,unknown>,budgetFailures:[] as string[],encoding:"captured UTF8text; not wire/compressed bytes; request serialization reconstructed", missing: 0, limited429: 0, errors: 0, failure: "" };
  const errors=proofErrors(error=>{result.status="unfinalized";result.failure=failureFact(error).message;});const captured=Object.assign(result,{failureFacts:errors.facts,cleanup:{startedMs:null as number|null,endedMs:null as number|null}});
  receipt.comparisons.push(captured);
  try {
    errors.save(save,"native initial save",true);captured.measuredStartedMs=performance.now();
    for (const label of labels) {
      const dir=join(root,`comparison-${index}-${label}`); cpSync(seedDir,dir,{recursive:true});
      servers[label]=await launch({dir,cwd:label==="base"?baseSource:process.cwd(),port:await freePort()});
    }
    const reads: Record<string,{path:string;schema:z.ZodType}> = {tasks:{path:`/tasks?projectId=${seed.projectId}&limit=50`,schema:tasksResponse}, detail:{path:`/tasks/${seed.tasks[0]}`,schema:taskDetailResponse}, board:{path:`/projects/${seed.projectId}/board`,schema:boardResponse}, overview:{path:"/overview?timezone=UTC",schema:overviewResponse}, tracking:{path:`/tracking/runs?projectId=${seed.projectId}&limit=50`,schema:trackingRunsResponse}, events:{path:`/runs/${seed.historic[0]}/events?limit=50`,schema:eventsResponse}};
    for (let ordinal = 0; ordinal < counts.samples+10; ordinal++) {
      const producer=ordinal%counts.producers, sequence=Math.floor(ordinal/counts.producers)+1;
      const body={schemaVersion:1,eventId:randomUUID(),runId:seed.runs[producer],sequence,type:sequence===1?"run.started":"run.heartbeat",occurredAt:"2026-10-10T00:00:00.000Z",payload:{}};
      for (const operation of ["ingestion",...Object.keys(reads)]) {
        for (const label of ordinal % 2 ? [...labels].reverse() : labels) {
          const server=servers[label]!;
          const request={label,operation,ordinal,warmup:ordinal<10,dispatchMs:performance.now(),status:null as number|null,generation:null as string|null,text:null as string|null,response:null as unknown,responseMs:null as number|null,failedMs:null as number|null,ms:null as number|null,error:null as ReturnType<typeof failureFact>|null,input:operation==="ingestion"?body:reads[operation].path,...(operation==="ingestion"?{eventId:body.eventId,digest:canonicalDigest(body)}:{})};captured.requests.push(request);
          try{
            const reply=await fetch(server.url+"/api/v1"+(operation==="ingestion"?`/runs/${body.runId}/events`:reads[operation].path),{method:operation==="ingestion"?"POST":"GET",headers:{Authorization:"Bearer "+server.credentials().reporterToken,...(operation==="ingestion"?{"Content-Type":"application/json"}:{})},body:operation==="ingestion"?JSON.stringify(body):undefined,redirect:"manual"});
            request.status=reply.status;request.generation=reply.headers.get("agentflow-generation");if(reply.status===429)captured.limited429++;else if(!reply.ok)captured.errors++;
            request.text=await reply.text();request.response=JSON.parse(request.text);request.responseMs=performance.now();request.ms=request.responseMs-request.dispatchMs;
            assert.equal(reply.status,operation==="ingestion"?201:200,"native operation rejected; retain failed raw sample");(operation==="ingestion"?eventResponse:reads[operation].schema).parse(request.response);
          }catch(error){request.failedMs=performance.now();request.error=failureFact(error);throw error;}
          if(ordinal>=10)operations[operation][label].push(request.ms!);
        }
      }
    }
    for(const [operation,samples]of Object.entries(operations)) {
      assert.equal(samples.base.length,counts.samples);assert.equal(samples.head.length,counts.samples);
      const base=distribution(samples.base),head=distribution(samples.head),changePercent=(head.p95Ms!/base.p95Ms!-1)*100;
      captured.operations[operation]={base,head,p95ChangePercent:changePercent};
      if(acceptance){if(base.p95Ms!>=250||head.p95Ms!>=250)captured.budgetFailures.push(`comparison ${index} ${operation} native p95 >=250ms`);if(changePercent>20)captured.budgetFailures.push(`comparison ${index} ${operation} p95 regression ${changePercent}% >20%`);}
    }
    captured.missing=Object.values(operations).reduce((sum,s)=>sum+2*counts.samples-s.base.length-s.head.length,0);
    receipt.failures.push(...captured.budgetFailures);if(captured.budgetFailures.length)throw new Error("NATIVE_BUDGET_FAILED");captured.status="finalized";
  } catch(error) {errors.capture("native work",error);}
  finally {
    if(captured.measuredStartedMs!==null)captured.measuredEndedMs??=performance.now();
    for(const [operation,samples] of Object.entries(operations)) if(!captured.operations[operation]) {
      const absent = { count: 0, p50Ms: null, p95Ms: null, maxMs: null, samplesMs: [] };
      captured.operations[operation] = { base: samples.base.length ? distribution(samples.base) : absent, head: samples.head.length ? distribution(samples.head) : absent };
    }
    captured.missing=Object.values(operations).reduce((sum,s)=>sum+2*counts.samples-s.base.length-s.head.length,0);
    errors.save(save,"native before cleanup");captured.cleanup.startedMs=performance.now();
    for(const [label,server]of Object.entries(servers))await errors.attempt("stop "+label,async()=>{await server?.stop();});
    captured.cleanup.endedMs=performance.now();errors.save(save,"native after cleanup");errors.throwFirst();
  }
}
