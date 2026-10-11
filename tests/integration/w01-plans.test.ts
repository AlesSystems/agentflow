import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { join } from "node:path";
import { launch } from "../fixtures/server";
it("publishes immutable branching revisions and rejects invalid links without writes", async () => {
 const server = await launch();
 try {
  const call = (path: string, input?: unknown, key = randomUUID()) => fetch(server.url + "/api/v1" + path, { method: input ? "POST" : "GET", headers: { Authorization: "Bearer " + server.credentials().reporterToken, "Content-Type": "application/json", "Idempotency-Key": key }, ...(input ? { body: JSON.stringify(input) } : {}) });
  const p = await call("/projects", { name: "Synthetic W01" });
  const projectId = (await p.json()).data.id;
  const id = randomUUID(), key = randomUUID();
  const input = { id, projectId, name: "Reported workflow" };
  const created = await call("/workflows", input, key);
  expect(created.status).toBe(201);
  const original = await created.json();
  expect(await (await call("/workflows", input, key)).json()).toEqual(original);
  const nodes = Array.from({ length: 3 }, (_, i) => ({ id: randomUUID(), label: "Node " + i }));
  const revisionId = randomUUID();
  const revision = { id: revisionId, expectedWorkflowVersion: 1, nodes, edges: [{ source: nodes[0].id, target: nodes[1].id }, { source: nodes[0].id, target: nodes[2].id }] };
  const published = await call(`/workflows/${id}/revisions`, revision);
  expect(published.status).toBe(201);
  const first = await published.json();
  const next = await call(`/workflows/${id}/revisions`, { ...revision, id: randomUUID(), expectedWorkflowVersion: 2, nodes: nodes.map(n => ({ ...n, label: "Changed" })) });
  expect(next.status).toBe(201);
  const read = await call(`/workflows/${id.toUpperCase()}/revisions/${revisionId.toUpperCase()}`);
  expect(read.status).toBe(200);
  expect((await read.json()).data).toEqual({ ...first.data, nodes, edges: revision.edges });
  const db = new Database(join(server.dir, "agentflow.sqlite"), { readonly: true });
  try {
   const before = db.prepare("SELECT * FROM changes").all();
   for (const rejected of [
    { ...revision, id: randomUUID(), expectedWorkflowVersion: 1 },
    { ...revision, id: randomUUID(), expectedWorkflowVersion: 3, nodes: [{ ...nodes[0], taskId: randomUUID() }] },
    { ...revision, id: randomUUID(), expectedWorkflowVersion: 3, edges: [{ source: nodes[0].id, target: nodes[0].id }] },
   ]) expect((await call(`/workflows/${id}/revisions`, rejected)).status).toBeGreaterThanOrEqual(400);
   expect(db.prepare("SELECT * FROM changes").all()).toEqual(before);
   expect((await call(`/workflows/${randomUUID()}/revisions/${revisionId}`)).status).toBe(404);
   expect((await call(`/workflows/${id}/revisions/not-a-uuid`)).status).toBe(422);
  } finally { db.close(); }
 } finally { await server.stop(); }
});
