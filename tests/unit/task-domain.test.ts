import { expect, it } from "vitest";
import { decideTask, type TaskFacts } from "../../src/domain/tasks";
import type { Task } from "../../src/contracts/tasks";
const task: Task = {
  id: "10000000-0000-4000-8000-000000000001",
  projectId: "10000000-0000-4000-8000-000000000002",
  title: "task",
  description: "work",
  acceptanceCriteria: "criteria",
  status: "review",
  priority: "normal",
  tags: [],
  assignedAgentId: null,
  targetRole: null,
  parentTaskId: null,
  branch: null,
  pullRequestUrl: null,
  blockedReason: null,
  version: 3,
  workRevision: 2,
  createdAt: "2026-10-09T00:00:00.000Z",
  updatedAt: "2026-10-09T00:00:00.000Z",
  completedAt: null,
};
const facts: TaskFacts = {
  projectArchived: false,
  activeRun: false,
  latestImplementation: null,
  hasImplementationHistory: false,
  ancestorIds: [],
};
it("compares work values rather than field presence", () => {
  expect(
    decideTask(
      task,
      { kind: "patch", expectedVersion: 3, changes: { description: "work" } },
      facts,
      "operator",
      0,
    ).task,
  ).toMatchObject({ version: 4, workRevision: 2, status: "review" });
  expect(
    decideTask(
      task,
      { kind: "patch", expectedVersion: 3, changes: { description: "new" } },
      facts,
      "operator",
      0,
    ).task,
  ).toMatchObject({ version: 4, workRevision: 3, status: "backlog" });
});
it("preserves accepted work when immutable comments append", () => {
  const accepted = decideTask(
    task,
    {
      kind: "complete",
      expectedVersion: 3,
      evidenceNote: "Synthetic test acceptance",
    },
    facts,
    "operator",
    0,
  ).task;
  expect(
    decideTask(
      accepted,
      { kind: "comment", text: "context" },
      facts,
      "reporter",
      1,
    ).task,
  ).toEqual(accepted);
  expect(
    decideTask(
      accepted,
      { kind: "reopen", expectedVersion: 4, reason: "rework" },
      facts,
      "operator",
      1,
    ).task,
  ).toMatchObject({
    version: 5,
    workRevision: 3,
    status: "backlog",
    completedAt: null,
  });
});
it("rejects stale, active, archived, reporter and obsolete implementation acceptance", () => {
  expect(() =>
    decideTask(
      task,
      { kind: "complete", expectedVersion: 2, evidenceNote: "test" },
      facts,
      "operator",
      0,
    ),
  ).toThrow("version_conflict");
  for (const overrides of [
    { activeRun: true },
    { projectArchived: true },
    {
      hasImplementationHistory: true,
      latestImplementation: {
        id: task.id,
        state: "succeeded",
        workRevision: 1,
      },
    },
  ])
    expect(() =>
      decideTask(
        task,
        { kind: "complete", expectedVersion: 3, evidenceNote: "test" },
        { ...facts, ...overrides },
        "operator",
        0,
      ),
    ).toThrow();
  expect(() =>
    decideTask(
      task,
      { kind: "complete", expectedVersion: 3, evidenceNote: "test" },
      facts,
      "reporter",
      0,
    ),
  ).toThrow("human_required");
});
