import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launch, pair } from "../fixtures/server";
it("inherits authenticated strict bounded requests and rejects cross-kind identities without writes", async () => {
 const server = await launch();
 try {
  const auth = { Authorization: "Bearer " + server.credentials().reporterToken, "Content-Type": "application/json" };
  const call = (path: string, input?: unknown, headers: Record<string,string> = auth, method = input ? "POST" : "GET") => fetch(server.url + "/api/v1" + path, { method, headers: { ...headers, "Idempotency-Key": randomUUID() }, ...(input ? { body: JSON.stringify(input) } : {}) });
  const create = async (path: string, input: unknown) => { const r = await call(path, input); expect(r.status).toBe(201); return (await r.json()).data; };
  const project = await create("/projects", { name: "Synthetic trust" }), other = await create("/projects", { name: "Other synthetic" });
  const otherTask = await create("/tasks", { projectId: other.id, title: "Cross project" });
  const workflow = await create("/workflows", { id: randomUUID(), projectId: project.id, name: "Bounds" });
  const node = { id: randomUUID(), label: "Node" };
  const revision = { id: randomUUID(), expectedWorkflowVersion: 1, nodes: [node], edges: [] };
  const published = await create(`/workflows/${workflow.id}/revisions`, revision);
  const run = await create("/workflow-runs", { id: randomUUID(), workflowId: workflow.id, planRevisionId: published.id });
  const start = { schemaVersion: 1, eventId: randomUUID(), workflowRunId: run.id, sequence: 1, occurredAt: "2026-10-11T00:00:00Z", type: "workflow.started", payload: {} };
  await create(`/workflow-runs/${run.id}/events`, start);
  const agent = await create("/agents", { displayName: "Synthetic", source: "W01", defaultRole: "implementation" });
  const taskRun = await create("/runs", { id: randomUUID(), projectId: project.id, agentId: agent.id, purpose: "planning" });
  const db = new Database(join(server.dir, "agentflow.sqlite"));
  const facts = () => Object.fromEntries(["workflows","workflow_revisions","workflow_runs","workflow_events","workflow_node_observations","changes","receipts","runs","run_events"].map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
  try {
   const before = facts();
   const path = `/workflow-runs/${run.id}/events`;
   const checks: [string, unknown, Record<string,string>, number][] = [
    [path, start, { "Content-Type": "application/json" }, 401],
    [path, start, { ...auth, Origin: "https://evil.example" }, 403],
    [path, { ...start, schemaVersion: 2 }, auth, 422],
    [path, { ...start, unknown: true }, auth, 422],
    [path, { ...start, workflowRunId: randomUUID() }, auth, 422],
    [path, { ...start, payload: { unexpected: true } }, auth, 422],
    [path, { ...start, occurredAt: "2026-10-12T00:00:00Z" }, auth, 409],
    [`/runs/${taskRun.id}/events`, { ...start, workflowRunId: undefined, runId: taskRun.id, type: "run.started" }, auth, 409],
    [`/workflows/${workflow.id}/revisions`, { ...revision, id: randomUUID(), expectedWorkflowVersion: 2, nodes: [{ ...node, taskId: otherTask.id }] }, auth, 409],
   ];
   for (const [target, input, headers, status] of checks) expect((await call(target, input, headers)).status).toBe(status);
   const oversized = { ...revision, id: randomUUID(), expectedWorkflowVersion: 2, nodes: Array.from({ length: 100 }, () => ({ id: randomUUID(), label: "界".repeat(200) })), edges: [] };
   expect((await call(`/workflows/${workflow.id}/revisions`, oversized)).status).toBe(413);
   expect((await call(`/workflows/${workflow.id}/revisions`, { ...revision, id: randomUUID(), expectedWorkflowVersion: 2, nodes: Array.from({ length: 101 }, () => ({ id: randomUUID(), label: "Extra" })) })).status).toBe(422);
   expect((await call(`/workflows/${workflow.id}/revisions/${published.id}?revisionId=x`)).status).toBe(400);
   expect(facts()).toEqual(before);
   const cookie = await pair(server);
   const last = db.prepare("SELECT last_received_at FROM workflow_runs WHERE id=?").get(run.id);
   db.prepare("UPDATE workflow_runs SET last_received_at=0 WHERE id=?").run(run.id);
   const closed = await call(`/workflow-runs/${run.id}/close`, { expectedVersion: 2, reason: "Synthetic stale observer" }, { Cookie: cookie, Origin: server.url, "Content-Type": "application/json" });
   expect(closed.status).toBe(200); const closure = (await closed.json()).data; expect(closure.state).toBe("interrupted"); expect(closure.lastReceivedAt).toBe("1970-01-01T00:00:00.000Z");
   expect(db.prepare("SELECT last_received_at FROM runs WHERE id=?").get(taskRun.id)).not.toEqual({ last_received_at: 0 });
   expect(last).toBeDefined();
   expect((await call(path, { ...start, eventId: randomUUID(), sequence: 2, type: "workflow.heartbeat" })).status).toBe(409);
   expect((await call(path, start)).status).toBe(200);
  } finally { db.close(); }
 } finally { await server.stop(); }
});
