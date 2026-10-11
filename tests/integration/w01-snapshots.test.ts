import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openOwnedStore } from "../../src/db";
import { restore } from "../../src/db/recovery";
import { canonicalDigest } from "../../src/domain/request-digest";
import type { ApplicationCommand } from "../../src/db/application";
it("preserves workflow ordinal, original ACK and bound cursors through VACUUM and restore", async () => {
 const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-w01-snapshot-"));
 let owned = await openOwnedStore(dir);
 const now = Date.parse("2026-10-11T00:00:00Z");
 const send = (command: ApplicationCommand, path: string, key = randomUUID()) => owned.store.command(command, { principal: "reporter", method: "POST", path, key, digest: canonicalDigest("input" in command ? command.input : {}), now });
 try {
  const project = send({ kind: "project.create", input: { name: "Synthetic bounded history" } }, "/api/v1/projects").body.data as { id: string };
  const workflowId = randomUUID(), revisionId = randomUUID(), nodeId = randomUUID();
  send({ kind: "workflow.create", input: { id: workflowId, projectId: project.id, name: "Order" } }, "/api/v1/workflows");
  send({ kind: "workflow.revision", id: workflowId, input: { id: revisionId, expectedWorkflowVersion: 1, nodes: [{ id: nodeId, label: "Node" }], edges: [] } }, `/api/v1/workflows/${workflowId}/revisions`);
  const ids = ["ffffffff-ffff-4fff-8fff-ffffffffffff", "00000000-0000-4000-8000-000000000001", randomUUID()];
  let original: unknown;
  for (const [index, id] of ids.entries()) {
   send({ kind: "workflow.run.register", input: { id, workflowId, planRevisionId: revisionId } }, "/api/v1/workflow-runs");
   const input = { schemaVersion: 1 as const, eventId: randomUUID(), workflowRunId: id, sequence: 1, occurredAt: new Date(now).toISOString(), type: "workflow.cancelled" as const, payload: { reason: "Synthetic terminal" } };
   const ack = send({ kind: "workflow.run.event", id, input }, `/api/v1/workflow-runs/${id}/events`);
   if (index === 0) original = { input, body: ack.body };
  }
  const query = { kind: "workflow.runs" as const, input: { workflowId, limit: 1 } };
  const first = owned.store.snapshot(query).body.data as { items: {id: string}[]; nextCursor: string; total: number };
  expect(first.items[0].id).toBe(ids[2]); expect(first.total).toBe(3);
  const second = owned.store.snapshot({ ...query, input: { ...query.input, cursor: first.nextCursor } }).body.data as { items: {id: string}[] };
  expect(second.items[0].id).toBe(ids[1]);
  const backup = join(dir, "backups", "workflow.sqlite"); await owned.store.backup(backup); const generation = owned.store.metadata().generation; owned.close();
  const db = new Database(join(dir, "agentflow.sqlite")); try { db.exec("VACUUM"); expect(db.prepare("SELECT last_value FROM run_order_allocator").get()).toEqual({ last_value: 0 }); expect(db.prepare("SELECT last_value FROM workflow_order_allocator").get()).toEqual({ last_value: 3 }); expect(() => db.prepare("UPDATE workflow_order_allocator SET last_value=0").run()).toThrow("advance"); expect(() => db.prepare("DELETE FROM workflow_order_allocator").run()).toThrow("delete"); expect(() => db.prepare("UPDATE workflow_runs SET registration_order=90 WHERE id=?").run(ids[0])).toThrow("immutable"); } finally { db.close(); }
  owned = await openOwnedStore(dir); expect(owned.store.snapshot(query).body.data).toEqual(first); owned.close();
  await restore(dir, backup); owned = await openOwnedStore(dir); expect(owned.store.metadata().generation).not.toBe(generation);
  expect(() => owned.store.snapshot({ ...query, input: { ...query.input, cursor: first.nextCursor } })).toThrow("cursor_invalid");
  const stored = original as { input: Extract<ApplicationCommand, {kind: "workflow.run.event"}>["input"]; body: unknown };
  expect(send({ kind: "workflow.run.event", id: ids[0], input: stored.input }, `/api/v1/workflow-runs/${ids[0]}/events`).body).toEqual(stored.body);
  expect(owned.store.integrity()).toEqual({ integrity: "ok", foreignKeys: [] });
 } finally { owned.close(); }
});
it("bounds event and node pages while returning every latest node under one snapshot", async () => {
 const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-w01-pages-")); const owned = await openOwnedStore(dir); let now = 1000;
 const send = (command: ApplicationCommand, path: string) => owned.store.command(command, { principal: "reporter", method: "POST", path, key: randomUUID(), digest: canonicalDigest("input" in command ? command.input : {}), now: now++ });
 try {
  const project = send({ kind: "project.create", input: { name: "Synthetic paging" } }, "/api/v1/projects").body.data as { id: string };
  const workflowId = randomUUID(), revisionId = randomUUID(), runId = randomUUID(), nodeId = randomUUID();
  send({ kind: "workflow.create", input: { id: workflowId, projectId: project.id, name: "Pages" } }, "/api/v1/workflows");
  send({ kind: "workflow.revision", id: workflowId, input: { id: revisionId, expectedWorkflowVersion: 1, nodes: [{ id: nodeId, label: "Repeated evidence" }], edges: [] } }, `/api/v1/workflows/${workflowId}/revisions`);
  send({ kind: "workflow.run.register", input: { id: runId, workflowId, planRevisionId: revisionId } }, "/api/v1/workflow-runs");
  for (let sequence = 1; sequence <= 103; sequence++) {
   const input: Extract<ApplicationCommand, {kind: "workflow.run.event"}>["input"] = sequence === 1 ? { schemaVersion: 1, eventId: randomUUID(), workflowRunId: runId, sequence, occurredAt: new Date(now).toISOString(), type: "workflow.started", payload: {} } : { schemaVersion: 1, eventId: randomUUID(), workflowRunId: runId, sequence, occurredAt: new Date(now).toISOString(), type: "workflow.node.reported", payload: { nodeId, state: "running" } };
   send({ kind: "workflow.run.event", id: runId, input }, `/api/v1/workflow-runs/${runId}/events`);
  }
  const events = owned.store.snapshot({ kind: "workflow.events", id: runId, input: { limit: 100 } }).body.data as { items: { sequence: number }[]; total: number; nextCursor: string };
  expect(events.items).toHaveLength(100); expect(events.total).toBe(103); expect(events.items[0].sequence).toBe(103);
  const rest = owned.store.snapshot({ kind: "workflow.events", id: runId, input: { limit: 100, cursor: events.nextCursor } }).body.data as { items: { sequence: number }[]; nextCursor: null };
  expect(rest.items.map(x => x.sequence)).toEqual([3,2,1]); expect(rest.nextCursor).toBeNull();
  const history = owned.store.snapshot({ kind: "workflow.nodes", id: runId, nodeId, input: { limit: 100 } }).body.data as { items: unknown[]; total: number };
  expect(history.items).toHaveLength(100); expect(history.total).toBe(102);
  const detail = owned.store.snapshot({ kind: "workflow.run", id: runId }).body.data as { nodes: { observation: { sequence: number } }[] };
  expect(detail.nodes).toHaveLength(1); expect(detail.nodes[0].observation.sequence).toBe(103);
 } finally { owned.close(); }
});
