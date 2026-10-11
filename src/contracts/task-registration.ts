import { z } from "zod";
import { envelope, uuid } from "./common";
import { taskResponse } from "./responses";
import type { SnapshotBody } from "../db/application";
const canonicalUuid = uuid.refine(value => value === value.toLowerCase());
export const taskRegistrationAcknowledgement = z.strictObject({
 kind: z.literal("task"), id: canonicalUuid, projectId: canonicalUuid,
 parentTaskId: canonicalUuid.nullable(), assignedAgentId: canonicalUuid.nullable(),
 version: z.literal(1), workRevision: z.literal(1),
});
export const taskRegistrationResponse = envelope(taskRegistrationAcknowledgement);
export function taskCreationPreference(value: string | null): boolean {
 const match=value?.match(/^[ \t]*([A-Za-z]+)[ \t]*=[ \t]*minimal[ \t]*$/);
 return match?.[1].toLowerCase() === "return";
}
export function projectTaskRegistration(body: SnapshotBody): SnapshotBody {
 const original = taskResponse.parse(body);
 const task = original.data;
 return taskRegistrationResponse.parse({ ...original, data: {
  kind: "task", id: task.id.toLowerCase(), projectId: task.projectId.toLowerCase(),
  parentTaskId: task.parentTaskId?.toLowerCase() ?? null,
  assignedAgentId: task.assignedAgentId?.toLowerCase() ?? null,
  version: task.version, workRevision: task.workRevision,
 } });
}
