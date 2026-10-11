import { z } from "zod";
import { changeCursor, timestamp, uuid } from "./common";
import { project } from "./projects";
import { task, comment, completion, reopen, run } from "./tasks";
import { agent, eventRecord } from "./observations";
import { artifactEvidence, gateDecision, reworkEvidence } from "./evidence";
import { workflow, planRevision, workflowRun, workflowEventRecord, nodeObservation } from "./workflows";
import { githubConnection, githubPullRequest, githubRepository, githubError } from "./github";
export const historyContent = z.enum(["tasks", "attempts", "workflows", "github"]);
export type HistoryContent = z.infer<typeof historyContent>;
export const historyExportInput = z.strictObject({
  content: z.array(historyContent).min(1).max(4).refine(values => new Set(values).size === values.length && values.every((v,i) => i === 0 || historyContent.options.indexOf(values[i-1]) < historyContent.options.indexOf(v))),
  generation: uuid,
});
export type HistoryExportInput = z.infer<typeof historyExportInput>;
export const historyExportQuery = z.strictObject({content:z.string(),generation:uuid});
export function parseHistoryExportRequest(url: URL): HistoryExportInput {
  const values: Record<string,string> = Object.create(null);
  for (const [key,value] of url.searchParams) {
    if (Object.hasOwn(values,key)) throw new Error("QUERY_INVALID");
    values[key]=value;
  }
  const query=historyExportQuery.parse(values);
  return historyExportInput.parse({content:query.content.split(","),generation:query.generation});
}
const closure = {id:uuid,reason:z.string(),actor:z.literal("operator"),createdAt:timestamp};
export const prunedHistoryEvent = z.strictObject({schemaVersion:z.literal(1),eventId:uuid,runId:uuid,sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),type:z.enum(["run.progress","run.heartbeat"]),occurredAt:timestamp,receivedAt:timestamp,payload:z.null(),payloadPrunedAt:timestamp});
export const historyEventRecord=z.union([eventRecord,prunedHistoryEvent]);
export const historyProjections = {
  project:project.omit({repositoryPath:true}), task, agent, comment, completion, reopen,
  dependency:z.strictObject({taskId:uuid,prerequisiteId:uuid,projectId:uuid}),
  artifact:artifactEvidence, decision:gateDecision, rework:reworkEvidence,
  runClosure:z.strictObject({...closure,runId:uuid}), workflowClosure:z.strictObject({...closure,workflowRunId:uuid}),
  run, runEvent:historyEventRecord, workflow, revision:planRevision, workflowRun, workflowEvent:workflowEventRecord, nodeObservation,
  connection:githubConnection.omit({credential:true,busy:true}),
  pullRequest:githubPullRequest.omit({stale:true,headChanged:true}),
  lookupAttempt:z.strictObject({repository:githubRepository,number:z.number().int().positive(),attemptedAt:timestamp,error:githubError.nullable()}),
};
export const historyGroups = {
  tasks:["project","task","agent","comment","completion","reopen","dependency","artifact","decision","rework","runClosure","workflowClosure"],
  attempts:["run","runEvent"], workflows:["workflow","revision","workflowRun","workflowEvent","nodeObservation"], github:["connection","pullRequest","lookupAttempt"],
} as const satisfies Record<HistoryContent,readonly (keyof typeof historyProjections)[]>;
export type HistoryRecordKind = keyof typeof historyProjections;
export type HistoryRecord = {[K in HistoryRecordKind]:{kind:K;data:z.infer<(typeof historyProjections)[K]>}}[HistoryRecordKind];
export const historyRecord = z.union(Object.entries(historyProjections).map(([kind,data]) => z.strictObject({kind:z.literal(kind),data})));
export const historyCounts = z.object(Object.fromEntries(Object.keys(historyProjections).map(kind=>[kind,z.number().int().nonnegative()]))).partial().strict();
export const historyManifest = z.strictObject({kind:z.literal("manifest"),schemaVersion:z.literal(1),generation:uuid,snapshotCursor:changeCursor,createdAt:timestamp,content:historyExportInput.shape.content,counts:historyCounts}).refine(value=>{const expected=value.content.flatMap(group=>[...historyGroups[group]]);return Object.keys(value.counts).length===expected.length && expected.every(kind=>Object.hasOwn(value.counts,kind));});
export const historyComplete = z.strictObject({kind:z.literal("complete"),schemaVersion:z.literal(1),counts:historyCounts});
export const historyLine = z.union([historyManifest,historyRecord,historyComplete]);
export type HistoryManifest = z.infer<typeof historyManifest>;
export type HistoryExportSnapshot = {manifest:HistoryManifest;nextBatch():HistoryRecord[];close():void};

