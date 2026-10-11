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
    data[field]=["tags","nodes","edges","repositories"].includes(field) ? JSON.parse(value as string) : ["enabled","draft","reviewRequired","verificationRequired"].includes(field) ? !!value : (field.endsWith("At") || field==="retryNotBefore") && value!==null && typeof value==="number" ? new Date(value).toISOString() : value;
  }
  if(kind === "runEvent" && row.payload_pruned_at !== null && row.payload_pruned_at !== undefined) {
    data.payload=null;data.payloadPrunedAt=new Date(row.payload_pruned_at as number).toISOString();
  }
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
    const manifest=historyManifest.parse({kind:"manifest",schemaVersion:1,generation:metadata.generation,snapshotCursor:cursor.cursor,createdAt:new Date(createdAt).toISOString(),content:input.content,counts});
    let index=0;let last:unknown[]|undefined;let closed=false;
    return {manifest,nextBatch() {
      if(closed)throw new Error("EXPORT_CLOSED");
      while(index<kinds.length) {
        const kind=kinds[index];const source=sources[kind];const keys=source.keys;
        const columns=[...new Set([...keys,...(source.body?["body"]:source.fields.map(snake))])];
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
