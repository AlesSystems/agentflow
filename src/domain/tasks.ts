import type { Task } from "../contracts/tasks";
const conflictTag = Symbol.for("agentflow.domain-conflict");
export class Conflict extends Error {
  readonly [conflictTag] = true;
  constructor(
    readonly code: string,
    readonly currentVersion?: number,
  ) {
    super(code);
  }
}
export type TaskFacts = {
  projectArchived: boolean;
  activeRun: boolean;
  latestImplementation: null | {
    id: string;
    state: string;
    workRevision: number | null;
  };
  hasImplementationHistory: boolean;
  ancestorIds: string[];
};
export type TaskCommand =
  | {
      kind: "patch";
      expectedVersion: number;
      changes: Partial<
        Pick<
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
          | "status"
        >
      >;
    }
  | {
      kind: "complete";
      expectedVersion: number;
      evidenceNote: string;
      evidenceUrl?: string | null;
    }
  | { kind: "reopen"; expectedVersion: number; reason: string }
  | { kind: "comment"; text: string };
export type TaskDecision = {
  task: Task;
  fact: TaskCommand["kind"];
  implementationRunId?: string | null;
};
export function decideTask(
  task: Task,
  command: TaskCommand,
  facts: TaskFacts,
  actor: "operator" | "reporter",
  now: number,
): TaskDecision {
  if (
    (command.kind === "complete" || command.kind === "reopen") &&
    actor !== "operator"
  )
    throw new Conflict("human_required");
  if (facts.projectArchived) throw new Conflict("project_archived");
  if (command.kind === "comment") return { task, fact: "comment" };
  if (command.expectedVersion !== task.version)
    throw new Conflict("version_conflict", task.version);
  const next = {
    ...task,
    version: task.version + 1,
    updatedAt: new Date(now).toISOString(),
  };
  if (command.kind === "reopen") {
    if (task.status !== "completed") throw new Conflict("task_not_completed");
    return {
      task: {
        ...next,
        status: "backlog",
        workRevision: task.workRevision + 1,
        completedAt: null,
      },
      fact: "reopen",
    };
  }
  if (task.status === "completed") throw new Conflict("task_completed");
  if (command.kind === "complete") {
    if (task.status !== "review") throw new Conflict("task_not_review");
    if (facts.activeRun) throw new Conflict("active_run");
    const latest = facts.latestImplementation;
    if (
      facts.hasImplementationHistory &&
      (!latest ||
        latest.state !== "succeeded" ||
        latest.workRevision !== task.workRevision)
    )
      throw new Conflict("implementation_not_current");
    return {
      task: {
        ...next,
        status: "completed",
        completedAt: new Date(now).toISOString(),
      },
      fact: "complete",
      implementationRunId: latest?.id ?? null,
    };
  }
  const changes = command.changes;
  const workChanged =
    (changes.description !== undefined &&
      changes.description !== task.description) ||
    (changes.acceptanceCriteria !== undefined &&
      changes.acceptanceCriteria !== task.acceptanceCriteria);
  const moved = changes.status !== undefined && changes.status !== task.status;
  if ((workChanged || moved) && facts.activeRun)
    throw new Conflict("active_run");
  if (
    changes.parentTaskId &&
    (changes.parentTaskId === task.id || facts.ancestorIds.includes(task.id))
  )
    throw new Conflict("parent_cycle");
  return {
    task: {
      ...next,
      ...changes,
      workRevision: task.workRevision + (workChanged ? 1 : 0),
      status:
        workChanged && task.status === "review"
          ? "backlog"
          : (changes.status ?? task.status),
    },
    fact: "patch",
  };
}

export function isConflict(value: unknown): value is Conflict {
  return value instanceof Error && (value as Conflict)[conflictTag] === true;
}
