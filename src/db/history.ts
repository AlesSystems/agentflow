import { totalTokens } from "../usage/decimal";
import Database from "better-sqlite3";
import type { z } from "zod";
import { historyGroups, historyManifest, historyProjections, type HistoryExportInput, type HistoryExportSnapshot, type HistoryRecord, type HistoryRecordKind } from "../contracts/history";
import { validateFile } from "../server/filesystem";
type Row=Record<string,unknown>;
type Source<K extends HistoryRecordKind>={table:string;keys:string[];fields:readonly Extract<keyof z.infer<(typeof historyProjections)[K]>,string>[];body?:boolean};
const sources: {[K in HistoryRecordKind]:Source<K>} = {
  project:{table:"projects",keys:["id"],fields:["id","name","archivedAt","version","createdAt","updatedAt"]},
  task:{table:"tasks",keys:["id"],fields:["title","description","acceptanceCriteria","priority","tags","assignedAgentId","targetRole","parentTaskId","branch","pullRequestUrl","blockedReason","id","projectId","status","version","workRevision","reviewRequired","verificationRequired","reworkRound","createdAt","updatedAt","completedAt"]},
  agent:{table:"agents",keys:["id"],fields:["id","displayName","source","defaultRole","version","createdAt"]},
  comment:{table:"comments",keys:["id"],fields:["id","taskId","text","actor","createdAt"]},
  completion:{table:"completions",keys:["id"],fields:["id","taskId","workRevision","implementationRunId","actor","evidenceNote","evidenceUrl","acceptedAt"]},
  reopen:{table:"reopens",keys:["id"],fields:["id","taskId","workRevision","actor","reason","createdAt"]},
  dependency:{table:"task_dependencies",keys:["task_id","prerequisite_id"],fields:["taskId","prerequisiteId","projectId"]},
  artifact:{table:"task_artifacts",keys:["id"],fields:["id","taskId","runId","workRevision","artifactRef","reworkRound","actor","displayUrl","createdAt"]},
  decision:{table:"gate_decisions",keys:["id"],fields:["id","taskId","runId","eventId","workRevision","artifactRef","reworkRound","purpose","decision","evidenceNote","createdAt"]},
  rework:{table:"task_reworks",keys:["id"],fields:["id","taskId","workRevision","reworkRound","reason","actor","createdAt"]},
  runClosure:{table:"run_closures",keys:["id"],fields:["id","runId","reason","actor","createdAt"]},
  workflowClosure:{table:"workflow_closures",keys:["id"],fields:["id","workflowRunId","reason","actor","createdAt"]},
  usageMeasurement:{table:"usage_measurements",keys:["run_id","usage_id"],fields:["runId","usageId","source","model","inputTokens","outputTokens","billingBasis","measuredAt","firstReceivedAt","totalTokens"]},
  usagePriceSnapshot:{table:"usage_price_snapshots",keys:["id"],fields:["id","name","capturedAt","effectiveAt","createdAt","entries"]},
  run:{table:"runs",keys:["id"],fields:["id","projectId","agentId","taskId","purpose","model","workRevision","artifactRef","reworkRound","state","lastSequence","lastReceivedAt","startedAt","endedAt","version","createdAt"]},
  runEvent:{table:"run_events",keys:["run_id","sequence"],fields:["schemaVersion","eventId","runId","sequence","type","occurredAt","receivedAt","payload"],body:true},
  workflow:{table:"workflows",keys:["id"],fields:["id","projectId","name","version","createdAt"]},
  revision:{table:"workflow_revisions",keys:["workflow_id","revision"],fields:["id","workflowId","revision","nodes","edges","createdAt"]},
  workflowRun:{table:"workflow_runs",keys:["id"],fields:["id","projectId","workflowId","planRevisionId","state","version","lastSequence","lastReceivedAt","createdAt","startedAt","endedAt"]},
  workflowEvent:{table:"workflow_events",keys:["workflow_run_id","sequence"],fields:["schemaVersion","eventId","workflowRunId","sequence","type","occurredAt","receivedAt","payload"],body:true},
  nodeObservation:{table:"workflow_node_observations",keys:["id"],fields:["schemaVersion","eventId","workflowRunId","sequence","type","occurredAt","receivedAt","payload"],body:true},
  connection:{table:"github_connection",keys:["singleton"],fields:["enabled","repositories","version","lastAttemptedAt","lastFetchedAt","lastError","retryNotBefore"]},
  pullRequest:{table:"github_pull_requests",keys:["repository","number"],fields:["repository","number","url","title","state","draft","headSha","baseBranch","mergedAt","previousHeadSha","fetchedAt","lastAttemptedAt","lastError"]},
  lookupAttempt:{table:"github_lookup_attempts",keys:["repository","number"],fields:["repository","number","attemptedAt","error"]},
};
const snake=(key:string)=>key.replace(/[A-Z]/g,v=>"_"+v.toLowerCase());
function projection(kind:HistoryRecordKind,row:Row):HistoryRecord {
  const source=sources[kind];
  const body=source.body ? JSON.parse(row.body as string) as Row : undefined;
  const data:Row={};
  for (const field of source.fields) {
    if(body) {data[field]=body[field];continue;}
    const value=row[snake(field)];
    data[field]=["tags","nodes","edges","repositories","entries"].includes(field) ? JSON.parse(value as string) : ["enabled","draft","reviewRequired","verificationRequired"].includes(field) ? !!value : (field.endsWith("At") || field==="retryNotBefore") && value!==null && typeof value==="number" ? new Date(value).toISOString() : value;
  }
  if(kind === "runEvent" && row.payload_pruned_at !== null && row.payload_pruned_at !== undefined) {
    data.payload=null;data.payloadPrunedAt=new Date(row.payload_pruned_at as number).toISOString();
  }
  if(kind==="usageMeasurement")data.totalTokens=totalTokens(row.input_tokens as number|null,row.output_tokens as number|null);
  return {kind,data:historyProjections[kind].parse(data)} as HistoryRecord;
}
export function openHistoryExportSnapshot(path:string,input:HistoryExportInput,createdAt:number):HistoryExportSnapshot {
  validateFile(path);
  const db=new Database(path,{readonly:true,fileMustExist:true});
  try {
    db.pragma("query_only = ON");
    if(db.pragma("integrity_check",{simple:true})!=="ok" || (db.pragma("foreign_key_check") as unknown[]).length) throw new Error("EXPORT_INTEGRITY_FAILED");
    const hasPrunedColumn=(db.prepare("PRAGMA table_info(run_events)").all() as {name:string}[]).some(column=>column.name === "payload_pruned_at");
    const metadata=db.prepare("SELECT generation FROM instance_metadata WHERE singleton=1").get() as {generation:string};
    const cursor=db.prepare("SELECT CAST(coalesce(max(cursor),0) AS TEXT) AS cursor FROM changes").get() as {cursor:string};
    const kinds=input.content.flatMap(group=>[...historyGroups[group]]) as HistoryRecordKind[];
    const counts:Record<string,number>={};
    for (const kind of kinds) counts[kind]=(db.prepare(`SELECT count(*) AS count FROM ${sources[kind].table}`).get() as {count:number}).count;
    const manifest=historyManifest.parse({kind:"manifest",schemaVersion:2,generation:metadata.generation,snapshotCursor:cursor.cursor,createdAt:new Date(createdAt).toISOString(),content:input.content,counts});
    let index=0;let last:unknown[]|undefined;let closed=false;
    return {manifest,nextBatch() {
      if(closed)throw new Error("EXPORT_CLOSED");
      while(index<kinds.length) {
        const kind=kinds[index];const source=sources[kind];const keys=source.keys;
        const columns=[...new Set([...keys,...(source.body?["body"]:source.fields.filter(field=>field!=="totalTokens").map(snake))])];
        if(kind === "runEvent") columns.push(hasPrunedColumn ? "payload_pruned_at" : "NULL AS payload_pruned_at");
        const where=last ? `WHERE (${keys.join(",")}) > (${keys.map(()=>"?").join(",")})` : "";
        const rows=db.prepare(`SELECT ${columns.join(",")} FROM ${source.table} ${where} ORDER BY ${keys.join(",")} LIMIT 100`).all(...(last ?? [])) as Row[];
        if(!rows.length){index++;last=undefined;continue;}
        last=keys.map(key=>rows.at(-1)![key]);
        return rows.map(row=>projection(kind,row));
      }
      return [];
    },close(){if(!closed){closed=true;db.close();}}};
  }catch(error){db.close();throw error;}
}

import { randomUUID } from "node:crypto";
import { canonicalDigest } from "../domain/request-digest";
import { Conflict } from "../domain/tasks";
import type { CommandContext, CommittedReply, SnapshotBody } from "./application";
import { retentionPreviewInput, retentionPruneInput, type RetentionPreviewInput, type RetentionPruneInput } from "../contracts/history";
export type PruneAdmission={input:RetentionPruneInput;context:CommandContext};
type Candidates={events:{event_id:string;run_id:string;sequence:number;digest:string;type:string;received_at:number}[];changes:{cursor:string;received_at:number;entity_type:string;entity_id:string;project_id:string|null;kind:string}[];hasMore:{eventPayloads:boolean;changes:boolean};highWater:string};
type Preview={id:string;principal:string;cutoff:number;expires_at:number;generation:string;version:number;digest:string;candidates:string;issued_at:number};
export class HistoryData {
 constructor(private readonly db:Database.Database) {}
 private body(data:unknown):SnapshotBody {
  const {generation}=this.db.prepare("SELECT generation FROM instance_metadata WHERE singleton=1").get() as {generation:string};
  const {cursor}=this.db.prepare("SELECT CAST(coalesce(max(cursor),0) AS TEXT) AS cursor FROM changes").get() as {cursor:string};
  return {data,generation,snapshotCursor:cursor};
 }
 private version(){return (this.db.prepare("SELECT version FROM retention_state WHERE singleton=1").get() as {version:number}).version;}
 private human(context:CommandContext){if(context.principal!=="operator")throw new Conflict("human_required");}
 private replay(context:CommandContext):CommittedReply|undefined {
  this.human(context);
  const row=this.db.prepare("SELECT digest,status,body FROM receipts WHERE principal=? AND method=? AND path=? AND key=?").get(context.principal,context.method,context.path,context.key) as {digest:string;status:number;body:string}|undefined;
  if(!row)return;
  if(row.digest!==context.digest)throw new Conflict("idempotency_conflict");
  return {status:row.status,body:JSON.parse(row.body)};
 }
 private receipt(context:CommandContext,reply:CommittedReply){this.db.prepare("INSERT INTO receipts VALUES(?,?,?,?,?,?,?)").run(context.principal,context.method,context.path,context.key,context.digest,reply.status,JSON.stringify(reply.body));}
 private candidates(cutoff:number):Candidates {
  const events=this.db.prepare("SELECT event_id,run_id,sequence,digest,type,received_at FROM retention_eligible_events WHERE received_at<? ORDER BY received_at,event_id LIMIT 1001").all(cutoff) as Candidates["events"];
  const changes=this.db.prepare("SELECT CAST(cursor AS TEXT) AS cursor,received_at,entity_type,entity_id,project_id,kind FROM changes WHERE received_at<? AND cursor<>(SELECT max(cursor) FROM changes) ORDER BY cursor LIMIT 1001").all(cutoff) as Candidates["changes"];
  const hasMore={eventPayloads:events.length>1000,changes:changes.length>1000};
  events.splice(1000);changes.splice(1000);
  return {events,changes,hasMore,highWater:this.body(null).snapshotCursor};
 }
 private digest(cutoff:number,generation:string,version:number,candidates:Candidates){return canonicalDigest({cutoff,generation,version,candidates});}
 preview(input:RetentionPreviewInput,context:CommandContext):CommittedReply {
  this.human(context);input=retentionPreviewInput.parse(input);
  return this.db.transaction(()=>{
   const replay=this.replay(context);if(replay)return replay;
   const cutoff=Date.parse(input.cutoff);if(cutoff>context.now)throw new Conflict("cutoff_invalid");
   this.db.prepare("DELETE FROM retention_previews WHERE expires_at<=? AND NOT EXISTS(SELECT 1 FROM retention_consumptions WHERE preview_id=retention_previews.id)").run(context.now);
   const {count}=this.db.prepare("SELECT count(*) AS count FROM retention_previews WHERE principal=? AND expires_at>? AND NOT EXISTS(SELECT 1 FROM retention_consumptions WHERE preview_id=retention_previews.id)").get(context.principal,context.now) as {count:number};
   if(count>=20)throw new Conflict("preview_limit");
   const generation=this.body(null).generation,version=this.version(),candidates=this.candidates(cutoff);
   const id=randomUUID(),expires=context.now+300000,digest=this.digest(cutoff,generation,version,candidates);
   this.db.prepare("INSERT INTO retention_previews VALUES(?,?,?,?,?,?,?,?,?)").run(id,context.principal,cutoff,expires,generation,version,digest,JSON.stringify(candidates),context.now);
   const reply={status:200,body:this.body({previewId:id,cutoff:input.cutoff,expiresAt:new Date(expires).toISOString(),expectedGeneration:generation,expectedVersion:version,candidateDigest:digest,counts:{eventPayloads:candidates.events.length,changes:candidates.changes.length},hasMore:candidates.hasMore})};
   this.receipt(context,reply);return reply;
  }).immediate();
 }
 private guard(input:RetentionPruneInput,context:CommandContext,now:number) {
  const row=this.db.prepare("SELECT * FROM retention_previews WHERE id=? AND principal=?").get(input.previewId,context.principal) as Preview|undefined;
  if(!row||row.expires_at<=now)throw new Conflict("preview_expired");
  if(this.db.prepare("SELECT 1 FROM retention_consumptions WHERE preview_id=?").get(row.id))throw new Conflict("preview_changed");
  const generation=this.body(null).generation,version=this.version();
  if(input.expectedGeneration!==row.generation||generation!==row.generation||input.expectedVersion!==row.version||version!==row.version||input.candidateDigest!==row.digest)throw new Conflict("preview_changed");
  const candidates=this.candidates(row.cutoff);
  if(this.digest(row.cutoff,generation,version,candidates)!==row.digest)throw new Conflict("preview_changed");
  return {row,candidates};
 }
 replayPrune(input:RetentionPruneInput,context:CommandContext):CommittedReply|undefined {
  this.human(context);retentionPruneInput.parse(input);
  return this.replay(context);
 }
 admitPrune(input:RetentionPruneInput,context:CommandContext):CommittedReply|PruneAdmission {
  this.human(context);input=retentionPruneInput.parse(input);
  return this.db.transaction(()=>{const replay=this.replay(context);if(replay)return replay;this.guard(input,context,context.now);return {input,context};}).immediate();
 }
 commitPrune(admission:PruneAdmission,now:number):CommittedReply {
  this.human(admission.context);
  return this.db.transaction(()=>{
   const replay=this.replay(admission.context);if(replay)return replay;
   const {row,candidates}=this.guard(admission.input,admission.context,now);
   let bytes=0;
   for(const event of candidates.events){
    const body=this.db.prepare("SELECT body,json_set(body,'$.payload',NULL) AS pruned FROM run_events WHERE event_id=?").get(event.event_id) as {body:string;pruned:string};
    bytes+=Math.max(0,Buffer.byteLength(body.body)-Buffer.byteLength(body.pruned));
    this.db.prepare("UPDATE run_events SET body=json_set(body,'$.payload',NULL),payload_pruned_at=? WHERE event_id=?").run(now,event.event_id);
   }
   for(const change of candidates.changes)this.db.prepare("DELETE FROM changes WHERE cursor=CAST(? AS INTEGER)").run(change.cursor);
   const generation=randomUUID();
   this.db.prepare("UPDATE instance_metadata SET generation=? WHERE singleton=1").run(generation);
   this.db.prepare("UPDATE retention_state SET version=version+1 WHERE singleton=1").run();
   this.db.prepare("INSERT INTO changes(entity_type,entity_id,project_id,kind,received_at) VALUES('retention','history',NULL,'pruned',?)").run(now);
   this.db.prepare("INSERT INTO retention_consumptions VALUES(?)").run(row.id);
   const reply={status:200,body:this.body({previewId:row.id,applied:{eventPayloads:candidates.events.length,changes:candidates.changes.length},prunedAt:new Date(now).toISOString(),priorGeneration:row.generation,generation,retentionVersion:this.version(),displayBodyBytesRemoved:bytes})};
   this.receipt(admission.context,reply);return reply;
  }).immediate();
 }
}
