import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { join } from "node:path";
import { launch, pair } from "../fixtures/server";
it("binds attempts to immutable plans and preserves append-only linked node evidence", async () => {
 let server = await launch();
 try {
  const call = (path: string, input?: unknown, human?: string) => fetch(server.url + "/api/v1" + path, { method: input ? "POST" : "GET", headers: { ...(human ? { Cookie: human, Origin: server.url } : { Authorization: "Bearer " + server.credentials().reporterToken }), "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, ...(input ? { body: JSON.stringify(input) } : {}) });
  const create = async (path: string, input: unknown) => { const r = await call(path, input); expect(r.status).toBe(201); return (await r.json()).data; };
  const project = await create("/projects", { name: "Synthetic observation" });
  const task = await create("/tasks", { projectId: project.id, title: "Preserved task" });
  const agent = await create("/agents", { displayName: "Synthetic", source: "W01", defaultRole: "implementation" });
  const taskRun = await create("/runs", { id: randomUUID(), projectId: project.id, agentId: agent.id, taskId: task.id, purpose: "verification", expectedTaskVersion: 1 });
  const workflow = await create("/workflows", { id: randomUUID(), projectId: project.id, name: "Branching" });
  const nodeId = randomUUID(), unknownNode = randomUUID();
  const revision = await create(`/workflows/${workflow.id}/revisions`, { id: randomUUID(), expectedWorkflowVersion: 1, nodes: [{ id: nodeId, label: "Node", taskId: task.id }, { id: unknownNode, label: "Unreported" }], edges: [{ source: nodeId, target: unknownNode }] });
  const registration = { id: randomUUID(), workflowId: workflow.id, planRevisionId: revision.id };
  const run = await create("/workflow-runs", registration);
  expect(run.state).toBe("queued");
  expect((await call("/workflow-runs", { ...registration, id: randomUUID() })).status).toBe(409);
  const event = (sequence: number, type: string, payload: unknown) => ({ schemaVersion: 1, eventId: randomUUID(), workflowRunId: run.id, sequence, occurredAt: "2026-10-11T00:00:00Z", type, payload });
  const started = event(1, "workflow.started", {});
  const start = await call(`/workflow-runs/${run.id}/events`, started); expect(start.status).toBe(201); const originalAck = await start.json();
  await create(`/workflow-runs/${run.id}/events`, event(2, "workflow.node.reported", { nodeId, runId: taskRun.id, state: "running", reportedSkill: { name: "<script>alert(1)</script>", source: "file:///private/inert" } }));
  await create(`/workflow-runs/${run.id}/events`, event(3, "workflow.node.reported", { nodeId, state: "succeeded" }));
  const snapshot = await call(`/workflow-runs/${run.id}`); expect(snapshot.status).toBe(200); const state = (await snapshot.json()).data;
  expect(state.nodes).toHaveLength(2);
  expect(state.nodes.find((n: { nodeId: string }) => n.nodeId === nodeId).observation.payload.reportedSkill).toBeUndefined();
  expect(state.nodes.find((n: { nodeId: string }) => n.nodeId === unknownNode).observation).toBeNull();
  const history = await call(`/workflow-runs/${run.id}/nodes/${nodeId}/observations`);
  expect(history.status).toBe(200); expect((await history.json()).data.items.map((v: { sequence: number }) => v.sequence)).toEqual([3,2]);
  const db = new Database(join(server.dir, "agentflow.sqlite"));
  try {
   const before = db.prepare("SELECT * FROM changes").all();
   for (const bad of [event(5, "workflow.heartbeat", {}), event(4, "workflow.node.reported", { nodeId: randomUUID(), state: "running" }), { ...started, occurredAt: "2026-10-12T00:00:00Z" }]) expect((await call(`/workflow-runs/${run.id}/events`, bad)).status).toBe(409);
   expect(db.prepare("SELECT * FROM changes").all()).toEqual(before);
   expect((await call(`/workflow-runs/${run.id}/close`, { expectedVersion: 4, reason: "forged" })).status).toBe(403);
   expect((await call(`/workflow-runs/${run.id}/close`, { expectedVersion: 4, reason: "fresh" }, await pair(server))).status).toBe(409);
  } finally { db.close(); }
  await create(`/workflow-runs/${run.id}/events`, event(4, "workflow.succeeded", { summary: "Reported only" }));
  expect((await (await call(`/tasks/${task.id}`)).json()).data.task.status).toBe("backlog");
  const duplicate = await call(`/workflow-runs/${run.id}/events`, started); expect(duplicate.status).toBe(200); expect(await duplicate.json()).toEqual(originalAck);
  await create(`/workflows/${workflow.id}/revisions`, { id: randomUUID(), expectedWorkflowVersion: 2, nodes: [{ id: nodeId, label: "Changed" }], edges: [] });
  const dir = server.dir; await server.stop(); server = await launch({ dir });
  const restarted = await call(`/workflow-runs/${run.id}`); expect((await restarted.json()).data.planRevisionId).toBe(revision.id);
  const adopted = await call("/workflow-runs", registration); expect(adopted.status).toBe(200); expect((await adopted.json()).data.state).toBe("queued");
 } finally { await server.stop(); }
});
