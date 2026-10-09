import { z } from "zod";
import { envelope, pageQuery, inputUuid, timestamp, uuid, safeUrl } from "./common";
import { observedRun, agent, runQuery, eventRecord } from "./observations";
import { task } from "./tasks";
import { list } from "./responses";
export const runSummary = observedRun.extend({
  agentName: z.string(), agentSource: z.string(), projectName: z.string(), taskTitle: z.string().nullable(),
  message: z.string().nullable(), evidenceUrl: safeUrl.nullable(),
});
export const trackedTask = task.extend({ latestAttempt: runSummary.nullable() });
export const trackingTasksResponse = envelope(list(trackedTask));
export const trackingBoardResponse = envelope(z.strictObject({ columns: z.array(z.strictObject({ status: task.shape.status, ...list(trackedTask).shape })) }));
export const trackingRunsResponse = envelope(list(runSummary));
export const trackingRunResponse = envelope(runSummary);
export const trackingAgent = agent.extend({ freshRunning: z.number().int().nonnegative(), queuedNoReport: z.number().int().nonnegative(), staleActive: z.number().int().nonnegative() });
export const trackingAgentsResponse = envelope(list(trackingAgent));
export const activityQuery = z.strictObject({ ...pageQuery, projectId: inputUuid.optional(), agentId: inputUuid.optional(), taskId: inputUuid.optional() });
export const activityItem = z.strictObject({
  id: z.string(), kind: z.enum(["report", "tracking_closed"]), runId: uuid, projectId: uuid, agentId: uuid, taskId: uuid.nullable(),
  agentName: z.string(), agentSource: z.string(), projectName: z.string(), taskTitle: z.string().nullable(), purpose: observedRun.shape.purpose, model: z.string().nullable(),
  receivedAt: timestamp, occurredAt: timestamp.nullable(), event: eventRecord.nullable(), reason: z.string().nullable(),
});
export const activityResponse = envelope(list(activityItem));
export { runQuery };
export type RunSummary = z.infer<typeof runSummary>;
