import type { Task } from "../contracts/tasks";
import type { FrozenCommand } from "./commands";
export type DraftFields = Pick<
  Task,
  | "title"
  | "description"
  | "acceptanceCriteria"
  | "priority"
  | "tags"
  | "assignedAgentId"
  | "targetRole"
  | "parentTaskId"
  | "branch"
  | "pullRequestUrl"
  | "blockedReason"
>;
export function fields(task: Task): DraftFields {
  const {
    title,
    description,
    acceptanceCriteria,
    priority,
    tags,
    assignedAgentId,
    targetRole,
    parentTaskId,
    branch,
    pullRequestUrl,
    blockedReason,
  } = task;
  return {
    title,
    description,
    acceptanceCriteria,
    priority,
    tags,
    assignedAgentId,
    targetRole,
    parentTaskId,
    branch,
    pullRequestUrl,
    blockedReason,
  };
}
export type Draft =
  | { phase: "editing"; base: Task; values: DraftFields }
  | {
      phase: "submitting" | "failed";
      base: Task;
      values: DraftFields;
      request: FrozenCommand;
      error?: string;
    }
  | {
      phase: "conflict";
      base: Task;
      values: DraftFields;
      request: FrozenCommand;
      current: Task;
    };
