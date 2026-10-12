import assert from "node:assert/strict";
import { z } from "zod";
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().min(1).max(200),source=z.enum(["base","head"]);
const declaration=z.object({id,source,operation:id,endpoint:z.string().startsWith("/api/v1/"),repetition:z.number().int().min(1).max(3),fixture:id,warmup:z.boolean()}).strict();
const fixture=z.object({id,source,sha256:hash,schema:z.number().int().positive(),generation:z.uuid(),cursor:z.string().regex(/^\d+$/)}).strict();
const resources=z.record(id,z.array(id).min(1));
const prepared=z.object({version:z.literal(1),scope:z.literal("task1-qualification"),sources:z.object({base:hash,head:hash}).strict(),helperSHA256:hash,runtimeSHA256:hash,builds:z.object({base:hash,head:hash}).strict(),intendedIds:z.array(id).min(1),declarations:z.array(declaration).min(1),fixtures:z.array(fixture).min(1),requiredResources:resources,correctness:z.object({cli:z.object({originalSHA256:hash,exitCode:z.literal(0),declared:z.array(id).min(1),acks:z.array(id).min(1)}).strict(),tabs:z.array(z.object({id,originalSHA256:hash,generation:z.uuid()}).strict()).length(2)}).strict(),officialWorkloadComplete:z.boolean()}).strict();
export type PreparedCampaign=z.infer<typeof prepared>;
const resultSchema=z.object({samples:z.array(z.object({id,accepted:z.boolean(),failure:z.string().nullable()}).strict()),resources:z.record(id,z.record(id,z.number().finite().nonnegative())),shutdown:z.object({closed:z.boolean(),stdioClosed:z.boolean(),exitCode:z.number().int().nullable(),signalCode:z.string().nullable()}).strict()}).strict();
export type CampaignResult=z.infer<typeof resultSchema>;
function unique(values:string[],label:string){assert.equal(new Set(values).size,values.length,`duplicate ${label}`);}
export function validatePrepared(input:unknown){
 const value=prepared.parse(input);assert.equal(value.officialWorkloadComplete,false,"Task1 qualification cannot claim official protocol readiness");unique(value.intendedIds,"intended IDs");unique(value.declarations.map(r=>r.id),"sample IDs");assert.deepEqual(value.declarations.map(r=>r.id),value.intendedIds,"missing or wrong intended sample IDs");unique(value.fixtures.map(r=>r.id),"fixture IDs");
 for(const row of value.declarations)assert(value.fixtures.some(f=>f.id===row.fixture&&f.source===row.source),"unbound declaration fixture/source");
 assert(Object.keys(value.requiredResources).length>0,"required resource owners absent");
 for(const keys of Object.values(value.requiredResources))unique(keys,"resource keys");
 for(const owner of ["service","browser"])assert(Object.hasOwn(value.requiredResources,owner),"required resource owner absent "+owner);
 const cli=value.correctness.cli;unique(cli.declared,"CLI IDs");unique(cli.acks,"CLI ACKs");assert.deepEqual([...cli.acks].sort(),[...cli.declared].sort(),"actual CLI acknowledgement witness incomplete");
 unique(value.correctness.tabs.map(t=>t.id),"tab IDs");assert(value.correctness.tabs.every(t=>value.fixtures.some(f=>f.generation===t.generation)),"stale two-tab generation");
 return {value,intended:value.intendedIds.length,officialReady:false as const};
}
export function validateResult(input:PreparedCampaign,observation:unknown){
 const result=resultSchema.parse(observation),{value,intended}=validatePrepared(input),wanted=new Set(value.declarations.map(r=>r.id));const counts=new Map<string,number>();
 for(const row of result.samples)counts.set(row.id,(counts.get(row.id)??0)+1);
 const missing=[...wanted].filter(id=>!counts.has(id)),failed=result.samples.filter(r=>!wanted.has(r.id)||counts.get(r.id)!==1||!r.accepted||r.failure!==null).map(r=>r.id);
 const resourceValid=Object.entries(value.requiredResources).every(([owner,keys])=>keys.every(key=>Object.hasOwn(result.resources[owner]??{},key)&&result.resources[owner][key]===0));
 const s=result.shutdown,shutdownValid=s.closed&&s.stdioClosed&&s.exitCode===0&&s.signalCode===null;
 return {intended,attempted:result.samples.length,accepted:result.samples.filter(r=>wanted.has(r.id)&&r.accepted&&r.failure===null).length,rejected:result.samples.filter(r=>!r.accepted).length,missing,failed,acceptance:!missing.length&&!failed.length&&resourceValid&&shutdownValid};
}
