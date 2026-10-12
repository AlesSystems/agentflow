import { usageMeasurement,usagePriceSnapshot } from "./usage";
import { z } from "zod";
import { changeCursor, timestamp, uuid, version, envelope } from "./common";
import { project } from "./projects";
import { task, comment, completion, reopen, run } from "./tasks";
import { agent, eventRecord, prunedEventRecord } from "./observations";
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
export const prunedHistoryEvent=prunedEventRecord;
export const historyEventRecord=eventRecord;
export const historyProjections = {
  project:project.omit({repositoryPath:true}), task, agent, comment, completion, reopen,
  dependency:z.strictObject({taskId:uuid,prerequisiteId:uuid,projectId:uuid}),
  artifact:artifactEvidence, decision:gateDecision, rework:reworkEvidence,
  runClosure:z.strictObject({...closure,runId:uuid}), workflowClosure:z.strictObject({...closure,workflowRunId:uuid}),
  run, runEvent:historyEventRecord, usageMeasurement, usagePriceSnapshot, workflow, revision:planRevision, workflowRun, workflowEvent:workflowEventRecord, nodeObservation,
  connection:githubConnection.omit({credential:true,busy:true}),
  pullRequest:githubPullRequest.omit({stale:true,headChanged:true}),
  lookupAttempt:z.strictObject({repository:githubRepository,number:z.number().int().positive(),attemptedAt:timestamp,error:githubError.nullable()}),
};
export const historyGroups = {
  tasks:["project","task","agent","comment","completion","reopen","dependency","artifact","decision","rework","runClosure","workflowClosure"],
  attempts:["run","runEvent","usageMeasurement","usagePriceSnapshot"], workflows:["workflow","revision","workflowRun","workflowEvent","nodeObservation"], github:["connection","pullRequest","lookupAttempt"],
} as const satisfies Record<HistoryContent,readonly (keyof typeof historyProjections)[]>;
export type HistoryRecordKind = keyof typeof historyProjections;
export type HistoryRecord = {[K in HistoryRecordKind]:{kind:K;data:z.infer<(typeof historyProjections)[K]>}}[HistoryRecordKind];
export const historyRecord = z.union(Object.entries(historyProjections).map(([kind,data]) => z.strictObject({kind:z.literal(kind),data})));
export const historyCounts = z.object(Object.fromEntries(Object.keys(historyProjections).map(kind=>[kind,z.number().int().nonnegative()]))).partial().strict();
export const historyManifest = z.strictObject({kind:z.literal("manifest"),schemaVersion:z.literal(2),generation:uuid,snapshotCursor:changeCursor,createdAt:timestamp,content:historyExportInput.shape.content,counts:historyCounts}).refine(value=>{const expected=value.content.flatMap(group=>[...historyGroups[group]]);return Object.keys(value.counts).length===expected.length && expected.every(kind=>Object.hasOwn(value.counts,kind));});
export const historyComplete = z.strictObject({kind:z.literal("complete"),schemaVersion:z.literal(2),counts:historyCounts});
export const historyLine = z.union([historyManifest,historyRecord,historyComplete]);
export type HistoryManifest = z.infer<typeof historyManifest>;
export type HistoryExportSnapshot = {manifest:HistoryManifest;nextBatch():HistoryRecord[];close():void};


export const retentionPreviewInput=z.strictObject({cutoff:timestamp.refine(value=>Number.isFinite(Date.parse(value)) && value.endsWith("Z"))});
export const retentionPruneInput=z.strictObject({previewId:uuid,expectedGeneration:uuid,expectedVersion:version,candidateDigest:z.string().regex(/^[0-9a-f]{64}$/)});
const retentionCounts=z.strictObject({eventPayloads:z.number().int().nonnegative().max(1000),changes:z.number().int().nonnegative().max(1000)});
export const retentionPreview=z.strictObject({previewId:uuid,cutoff:timestamp,expiresAt:timestamp,expectedGeneration:uuid,expectedVersion:version,candidateDigest:retentionPruneInput.shape.candidateDigest,counts:retentionCounts,hasMore:z.strictObject({eventPayloads:z.boolean(),changes:z.boolean()})});
export const retentionPrune=z.strictObject({previewId:uuid,applied:retentionCounts,prunedAt:timestamp,priorGeneration:uuid,generation:uuid,retentionVersion:version,displayBodyBytesRemoved:z.number().int().nonnegative()});
export const retentionPreviewResponse=envelope(retentionPreview);
export const retentionPruneResponse=envelope(retentionPrune);
export type RetentionPreviewInput=z.infer<typeof retentionPreviewInput>;
export type RetentionPruneInput=z.infer<typeof retentionPruneInput>;

export const historyManifestV1=z.strictObject({...historyManifest.shape,schemaVersion:z.literal(1),counts:historyCounts.omit({usageMeasurement:true,usagePriceSnapshot:true})}).refine(value=>{const expected=value.content.flatMap(group=>historyGroups[group].filter(kind=>kind!=="usageMeasurement"&&kind!=="usagePriceSnapshot"));return Object.keys(value.counts).length===expected.length&&expected.every(kind=>Object.hasOwn(value.counts,kind));});
export const historyCompleteV1=historyComplete.extend({schemaVersion:z.literal(1),counts:historyCounts.omit({usageMeasurement:true,usagePriceSnapshot:true})});
export const historyRecordV1=z.union(Object.entries(historyProjections).filter(([kind])=>kind!=="usageMeasurement"&&kind!=="usagePriceSnapshot").map(([kind,data])=>z.strictObject({kind:z.literal(kind),data})));
