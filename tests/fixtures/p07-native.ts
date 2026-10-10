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
  assert(samples.length, "missing samples");
  const sorted = [...samples].sort((a,b) => a-b);
  return { count: samples.length, p50Ms: sorted[Math.ceil(sorted.length*.5)-1], p95Ms: sorted[Math.ceil(sorted.length*.95)-1], maxMs: sorted.at(-1)!, samplesMs: samples };
}
export async function nativeCompare(options:NativeOptions) {
  const {index,baseSource,seed,seedDir,root,counts,acceptance,receipt,save}=options;
  const labels = index % 2 ? ["base","head"] as const : ["head","base"] as const;
  const servers: Partial<Record<"base"|"head", Awaited<ReturnType<typeof launch>>>> = {};
  const operations: Record<string,{base:number[];head:number[]}> = Object.fromEntries(["ingestion","tasks","detail","board","overview","tracking","events"].map(name=>[name,{base:[],head:[]} ]));
  const result = { index, measuredStartedMs: performance.now(), measuredEndedMs: null as number|null, order: labels, requests: [] as {label:string;operation:string;ordinal:number;warmup:boolean;status:number;ms:number;input?:unknown;response?:unknown;eventId?:string;digest?:string}[], operations: {} as Record<string,unknown>, missing: 0, limited429: 0, errors: 0, failure: "" };
  receipt.comparisons.push(result); save();
  try {
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
          const t=performance.now();
          const reply=await fetch(server.url+"/api/v1"+(operation==="ingestion"?`/runs/${body.runId}/events`:reads[operation].path),{method:operation==="ingestion"?"POST":"GET",headers:{Authorization:"Bearer "+server.credentials().reporterToken,...(operation==="ingestion"?{"Content-Type":"application/json"}:{})},body:operation==="ingestion"?JSON.stringify(body):undefined,redirect:"manual"});
          const raw=await reply.json(); const ms=performance.now()-t;
          result.requests.push({label,operation,ordinal,warmup:ordinal<10,status:reply.status,ms,input:operation==="ingestion"?body:reads[operation].path,response:raw,...(operation==="ingestion"?{eventId:body.eventId,digest:canonicalDigest(body)}:{})});
          if(reply.status===429)result.limited429++;else if(!reply.ok)result.errors++;
          assert.equal(reply.status,operation==="ingestion"?201:200,"native operation rejected; retain failed raw sample");
          (operation==="ingestion"?eventResponse:reads[operation].schema).parse(raw);
          if(ordinal>=10)operations[operation][label].push(ms);
        }
      }
    }
    for(const [operation,samples]of Object.entries(operations)) {
      assert.equal(samples.base.length,counts.samples);assert.equal(samples.head.length,counts.samples);
      const base=distribution(samples.base),head=distribution(samples.head),changePercent=(head.p95Ms/base.p95Ms-1)*100;
      result.operations[operation]={base,head,p95ChangePercent:changePercent};
      if(acceptance){if(base.p95Ms>=250||head.p95Ms>=250)receipt.failures.push(`comparison ${index} ${operation} native p95 >=250ms`);if(changePercent>20)receipt.failures.push(`comparison ${index} ${operation} p95 regression ${changePercent}% >20%`);}
    }
    result.missing=Object.values(operations).reduce((sum,s)=>sum+2*counts.samples-s.base.length-s.head.length,0);
  } catch(error) { result.failure=error instanceof Error?error.message:"unknown"; throw error; }
  finally {
    result.measuredEndedMs=performance.now();
    for(const [operation,samples] of Object.entries(operations)) if(!result.operations[operation]) {
      const absent = { count: 0, p50Ms: null, p95Ms: null, maxMs: null, samplesMs: [] };
      result.operations[operation] = { base: samples.base.length ? distribution(samples.base) : absent, head: samples.head.length ? distribution(samples.head) : absent };
    }
    result.missing=Object.values(operations).reduce((sum,s)=>sum+2*counts.samples-s.base.length-s.head.length,0);
    for(const server of Object.values(servers))await server?.stop(); save();
  }
}
