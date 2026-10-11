import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launch } from "../fixtures/server";
import { migrations, openOwnedStore } from "../../src/db";
for (const mode of ["before", "after"] as const) for (const operation of ["workflow", "revision", "run", "event"] as const) it(`recovers workflow ${operation} SIGKILL ${mode} commit with original receipt`, async () => {
 const key = randomUUID();
 let server = await launch({ entry: "tests/fixtures/crash-server.ts", extraEnv: { AGENTFLOW_TEST_KEY: key, AGENTFLOW_TEST_CRASH: mode } });
 try {
  const call = (path: string, input: unknown, identity = randomUUID()) => fetch(server.url + "/api/v1" + path, { method: "POST", headers: { Authorization: "Bearer " + server.credentials().reporterToken, "Content-Type": "application/json", "Idempotency-Key": identity }, body: JSON.stringify(input) });
  const create = async (path: string, input: unknown) => { const r = await call(path, input); expect(r.status).toBe(201); return (await r.json()).data.id; };
  const projectId = await create("/projects", { name: "Synthetic W01 crash" });
  const workflowId = randomUUID(), revisionId = randomUUID(), workflowRunId = randomUUID();
  const workflow = { id: workflowId, projectId, name: "Crash recovery" };
  const revision = { id: revisionId, expectedWorkflowVersion: 1, nodes: [{ id: randomUUID(), label: "Synthetic" }], edges: [] };
  const registration = { id: workflowRunId, workflowId, planRevisionId: revisionId };
  if (operation !== "workflow") await create("/workflows", workflow);
  if (operation === "run" || operation === "event") await create(`/workflows/${workflowId}/revisions`, revision);
  if (operation === "event") await create("/workflow-runs", registration);
  const input = operation === "workflow" ? workflow : operation === "revision" ? revision : operation === "run" ? registration : { schemaVersion: 1, eventId: randomUUID(), workflowRunId, sequence: 1, occurredAt: "2026-10-11T00:00:00Z", type: "workflow.started", payload: {} };
  const path = operation === "workflow" ? "/workflows" : operation === "revision" ? `/workflows/${workflowId}/revisions` : operation === "run" ? "/workflow-runs" : `/workflow-runs/${workflowRunId}/events`;
  const dir = server.dir;
  const inspect = () => { const db = new Database(join(dir, "agentflow.sqlite"), { readonly: true }); try { return Object.fromEntries(["workflows","workflow_revisions","workflow_runs","workflow_events","workflow_order_allocator","run_order_allocator","changes","receipts"].map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()])); } finally { db.close(); } };
  const before = inspect();
  await expect(call(path, input, key)).rejects.toThrow(); await server.stop(); expect(server.child.signalCode).toBe("SIGKILL");
  const killed = inspect(); if (mode === "before") expect(killed).toEqual(before); else expect(killed).not.toEqual(before);
  server = await launch({ dir });
  const retried = await call(path, input, key); expect(retried.status).toBe(operation === "event" && mode === "after" ? 200 : 201); const receipt = await retried.json();
  const committed = inspect();
  expect(await (await call(path, input, key)).json()).toEqual(receipt); expect(inspect()).toEqual(committed);
  if (mode === "after") expect(committed).toEqual(killed);
 } finally { await server.stop(); }
});
it("rolls the additive workflow migration back and upgrades the P07 schema atomically", async () => {
 const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-w01-migration-"));
 const prefix = migrations.slice(0, 6); const base = await openOwnedStore(dir, prefix); base.close();
 const original = migrations[6];
 const sql = original.sql + "\nINSERT INTO missing_workflow_failure VALUES(1);";
 await expect(openOwnedStore(dir, [...prefix, { ...original, sql, sha256: createHash("sha256").update(sql).digest("hex") }])).rejects.toThrow();
 const db = new Database(join(dir, "agentflow.sqlite"), { readonly: true });
 try { expect(db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'workflow%'").all()).toEqual([]); expect(db.prepare("SELECT count(*) AS n FROM migration_history").get()).toEqual({ n: 6 }); } finally { db.close(); }
 const upgraded = await openOwnedStore(dir); try { expect(upgraded.store.integrity()).toEqual({ integrity: "ok", foreignKeys: [] }); expect(upgraded.store.metadata().schemaVersion).toBe(7); } finally { upgraded.close(); }
});
