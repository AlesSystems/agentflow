import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { openOwnedStore } from "../../src/db";
import { canonicalDigest } from "../../src/domain/request-digest";
import type { ApplicationCommand } from "../../src/db/application";
import type { Task } from "../../src/contracts/tasks";

it("keeps required negatives sticky, invalidates evidence on rework, and replays original commands", async () => {
  const owned = await openOwnedStore(mkdtempSync(join(realpathSync(tmpdir()), "w02-evidence-")));
  const send = (command: ApplicationCommand, key = randomUUID(), principal: "operator" | "reporter" = "operator") => owned.store.command(command, { principal, method: "POST", path: command.kind, key, digest: canonicalDigest(command), now: Date.now() });
  const get = (id: string) => (owned.store.snapshot({ kind: "task", id, input: { history: "both", historyLimit: 10 } }).body.data as { task: Task }).task;
  try {
    const projectId = (send({ kind: "project.create", input: { name: "Synthetic W02" } }).body.data as { id: string }).id;
    const agentId = (send({ kind: "agent.create", input: { displayName: "Synthetic", source: "fixture", defaultRole: "reviewer" } }).body.data as { id: string }).id;
    const id = (send({ kind: "task.create", input: { projectId, title: "Manual evidence" } }).body.data as { id: string }).id;
    send({ kind: "task.review-policy", id, input: { expectedVersion: 1, reviewRequired: true, verificationRequired: false } });
    send({ kind: "task.artifact", id, input: { expectedVersion: get(id).version, artifactRef: "synthetic:A" } });
    const gate = (decision: "approved" | "changes_requested") => {
      const task = get(id); const runId = randomUUID();
      send({ kind: "run.register", input: { id: runId, projectId, agentId, taskId: id, purpose: "review", expectedTaskVersion: task.version, workRevision: task.workRevision, artifactRef: "synthetic:A", reworkRound: task.reworkRound } });
      for (const [sequence, type, payload] of [[1, "run.started", {}], [2, "run.succeeded", { summary: "reviewed", decision, evidenceNote: "Synthetic review" }]] as const)
        send({ kind: "run.event", id: runId, input: { schemaVersion: 1, eventId: randomUUID(), runId, sequence, occurredAt: new Date().toISOString(), type, payload } });
    };
    gate("changes_requested"); gate("approved");
    send({ kind: "task.patch", id, input: { expectedVersion: get(id).version, status: "review" } });
    expect(() => send({ kind: "task.complete", id, input: { expectedVersion: get(id).version, evidenceNote: "Synthetic acceptance" } })).toThrow("changes_requested");
    const command: ApplicationCommand = { kind: "task.rework", id, input: { expectedVersion: get(id).version, reason: "Fix review" } }; const key = randomUUID();
    const reply = send(command, key);
    expect(get(id)).toMatchObject({ workRevision: 2, reworkRound: 1, status: "backlog" });
    expect(send(command, key)).toEqual(reply);
    expect(() => send(command, key, "reporter")).toThrow("human_required");
  } finally { owned.close(); }
});
