import { z } from "zod";
import { envelope, inputUuid, pageQuery, requiredText, timestamp, uuid, version } from "./common";
import { freshness } from "./observations";
export const workflowCreate = z.strictObject({ id: inputUuid, projectId: inputUuid, name: requiredText(200) });
export const planNode = z.strictObject({ id: inputUuid, label: requiredText(200), taskId: inputUuid.optional() });
export const planEdge = z.strictObject({ source: inputUuid, target: inputUuid, order: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() });
export const workflowPlan = z.strictObject({ nodes: z.array(planNode).min(1).max(100), edges: z.array(planEdge).max(200) });
export const planRevisionCreate = workflowPlan.extend({ id: inputUuid, expectedWorkflowVersion: version });
export const workflowRunRegister = z.strictObject({ id: inputUuid, workflowId: inputUuid, planRevisionId: inputUuid });
export const workflowClose = z.strictObject({ expectedVersion: version, reason: requiredText(4000) });
export const workflow = z.strictObject({ id: uuid, projectId: uuid, name: z.string(), version, createdAt: timestamp });
export const planRevision = workflowPlan.extend({ id: uuid, workflowId: uuid, revision: version, createdAt: timestamp });
export const workflowRun = z.strictObject({ id: uuid, projectId: uuid, workflowId: uuid, planRevisionId: uuid, state: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "interrupted"]), version, lastSequence: z.number().int().nonnegative(), lastReceivedAt: timestamp, createdAt: timestamp, startedAt: timestamp.nullable(), endedAt: timestamp.nullable() });
export const reportedSkill = z.strictObject({ name: requiredText(200), source: requiredText(2000).optional(), version: requiredText(200).optional() });
const base = { schemaVersion: z.literal(1), eventId: inputUuid, workflowRunId: inputUuid, sequence: version, occurredAt: z.iso.datetime({ offset: true }).transform(v => new Date(v).toISOString()).pipe(timestamp) };
export const nodePayload = z.strictObject({ nodeId: inputUuid, runId: inputUuid.optional(), state: z.enum(["pending", "running", "succeeded", "failed", "cancelled"]), reportedSkill: reportedSkill.optional() });
export const workflowEventInput = z.discriminatedUnion("type", [
 z.strictObject({ ...base, type: z.literal("workflow.started"), payload: z.strictObject({}) }),
 z.strictObject({ ...base, type: z.literal("workflow.heartbeat"), payload: z.strictObject({}) }),
 z.strictObject({ ...base, type: z.literal("workflow.node.reported"), payload: nodePayload }),
 z.strictObject({ ...base, type: z.literal("workflow.succeeded"), payload: z.strictObject({ summary: requiredText(4000) }) }),
 z.strictObject({ ...base, type: z.literal("workflow.failed"), payload: z.strictObject({ message: requiredText(4000), code: requiredText(100).optional() }) }),
 z.strictObject({ ...base, type: z.literal("workflow.cancelled"), payload: z.strictObject({ reason: requiredText(4000) }) }),
]);
export const workflowAcknowledgement = z.strictObject({ eventId: uuid, workflowRunId: uuid, acceptedSequence: version, receivedAt: timestamp });
export const workflowEventRecord = z.union(workflowEventInput.options.map(option => option.extend({ receivedAt: timestamp })));
export const workflowQuery = z.strictObject({ ...pageQuery, projectId: inputUuid });
export const workflowHistoryQuery = z.strictObject(pageQuery);
export const workflowRunQuery = z.strictObject({ ...pageQuery, workflowId: inputUuid, planRevisionId: inputUuid.optional() });
const list = <S extends z.ZodType>(item: S) => z.strictObject({ items: z.array(item), total: z.number().int().nonnegative(), nextCursor: z.string().nullable() });
export const workflowResponse = envelope(workflow);
export const workflowsResponse = envelope(list(workflow));
export const revisionResponse = envelope(planRevision);
export const revisionsResponse = envelope(list(planRevision));
export const observedWorkflowRun = workflowRun.extend({ freshness });
export const workflowRunResponse = envelope(observedWorkflowRun);
export const workflowRunsResponse = envelope(list(observedWorkflowRun));
export const workflowEventResponse = envelope(workflowAcknowledgement);
export const workflowEventsResponse = envelope(list(workflowEventRecord));
export type WorkflowPlan = z.infer<typeof workflowPlan>;
export type WorkflowRunFacts = z.infer<typeof workflowRun>;
export type WorkflowEventInput = z.infer<typeof workflowEventInput>;
