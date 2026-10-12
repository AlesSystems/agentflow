import { expect, it } from "vitest";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openOwnedStore } from "../../src/db";
import type { ApplicationCommand } from "../../src/db/application";
import { canonicalDigest } from "../../src/domain/request-digest";
import { runResponse } from "../../src/contracts/observations";
it("omits only an absent run evidence pair and preserves meaningful tuples and strict current parsing", async () => {
  const owned = await openOwnedStore(mkdtempSync(join(realpathSync(tmpdir()), "w04-wire-")));
  const send = (command: ApplicationCommand, principal: "reporter" | "operator" = "reporter") => owned.store.command(command, { principal, method: "POST", path: command.kind, key: randomUUID(), digest: canonicalDigest(command.input), now: Date.now() });
  try {
    const projectId = (send({ kind: "project.create", input: { name: "Synthetic wire" } }).body.data as { id: string }).id;
    const agentId = (send({ kind: "agent.create", input: { displayName: "Synthetic", source: "fixture", defaultRole: "reviewer" } }).body.data as { id: string }).id;
    const id = randomUUID(), registered = send({ kind: "run.register", input: { id, projectId, agentId, purpose: "planning" } });
    const detail = owned.store.snapshot({ kind: "run", id }).body;
    for (const body of [registered.body, detail]) {
      expect(Object.hasOwn(body.data as object, "artifactRef")).toBe(false);
      expect(Object.hasOwn(body.data as object, "reworkRound")).toBe(false);
      expect(body.data).toMatchObject({ id, projectId, agentId, purpose: "planning", state: "queued", lastSequence: 0, version: 1 });
      expect(runResponse.parse(body).data).toMatchObject({ artifactRef: null, reworkRound: null });
      expect(runResponse.safeParse({ ...body, data: { ...body.data as object, unrelated: true } }).success).toBe(false);
    }
    const taskId = (send({ kind: "task.create", input: { projectId, title: "Required tuple" } }).body.data as { id: string }).id;
    send({ kind: "task.review-policy", id: taskId, input: { expectedVersion: 1, reviewRequired: true, verificationRequired: false } }, "operator");
    send({ kind: "task.artifact", id: taskId, input: { expectedVersion: 2, artifactRef: "synthetic:wire-artifact" } }, "operator");
    const gateId = randomUUID();
    const gate = send({ kind: "run.register", input: { id: gateId, projectId, agentId, taskId, purpose: "review", expectedTaskVersion: 3, workRevision: 1, artifactRef: "synthetic:wire-artifact", reworkRound: 0 } });
    expect(gate.body.data).toMatchObject({ artifactRef: "synthetic:wire-artifact", reworkRound: 0, workRevision: 1 });
    expect(owned.store.snapshot({ kind: "run", id: gateId }).body.data).toMatchObject({ artifactRef: "synthetic:wire-artifact", reworkRound: 0, workRevision: 1 });
  } finally { owned.close(); }
});
