import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { launch } from "../fixtures/server";
import { cliFixture } from "../fixtures/p06-cli";
it("durably orders never-delivered workflow revisions attempts and reports while isolating same UUID task producers", async () => {
 let server = await launch(); const f = cliFixture(server);
 const create = async (args: string[], body: unknown) => { const result = await f.cli([...args, "--file", f.file(body), "--idempotency-key", randomUUID()]); expect(result.code).toBe(0); return JSON.parse(result.stdout).id as string; };
 try {
  const projectId = await create(["project","create"], { name: "Synthetic offline chain" });
  const agentId = await create(["agent","register"], { displayName: "Synthetic", source: "W01", defaultRole: "implementation" });
  const sameId = randomUUID(); await create(["run","register"], { id: sameId, projectId, agentId, purpose: "planning" });
  const workflowId = randomUUID(), revisionId = randomUUID(), nodeId = randomUUID();
  const dir = server.dir, port = server.port; await server.stop();
  const offline = {};
  for (const [args, body] of [
   [["register","workflow"], { id: workflowId, projectId, name: "Never delivered" }],
   [["register","workflow-revision","--workflow",workflowId], { id: revisionId, expectedWorkflowVersion: 1, nodes: [{ id: nodeId, label: "Node" }], edges: [] }],
   [["register","workflow-run"], { id: sameId, workflowId, planRevisionId: revisionId }],
  ] as [string[],unknown][]) expect((await f.cli([...args,"--file",f.file(body),"--idempotency-key",randomUUID()],offline)).code).toBe(2);
  const started = await f.cli(["report","--workflow-run",sameId,"--type","workflow.started","--payload",f.file({})],offline); expect(started.code).toBe(2);
  expect((await f.cli(["report","--run",sameId,"--type","run.started","--payload",f.file({})],offline)).code).toBe(2);
  const workflowDir = join(f.env.AGENTFLOW_OUTBOX_DIR,"workflow-runs",sameId);
  const envelopeName = readdirSync(workflowDir).find(n => /^1-/.test(n))!; const original = readFileSync(join(workflowDir,envelopeName));
  expect(JSON.parse(original.toString()).producerKind).toBe("workflow-run");
  expect(JSON.parse(readFileSync(join(f.env.AGENTFLOW_OUTBOX_DIR,sameId,"state.json"),"utf8")).allocatedThrough).toBe(1);
  expect(JSON.parse(readFileSync(join(workflowDir,"state.json"),"utf8")).allocatedThrough).toBe(1);
  server = await launch({ dir, port });
  const flush = await f.cli(["flush"]); expect(flush.code).toBe(0);
  const db = new Database(join(dir,"agentflow.sqlite"), { readonly: true });
  try { expect(db.prepare("SELECT last_sequence FROM workflow_runs WHERE id=?").get(sameId)).toEqual({last_sequence:1}); expect(db.prepare("SELECT last_sequence FROM runs WHERE id=?").get(sameId)).toEqual({last_sequence:1}); expect(JSON.parse((db.prepare("SELECT body FROM workflow_events WHERE workflow_run_id=?").get(sameId) as {body:string}).body)).toMatchObject(JSON.parse(original.toString()).body); } finally { db.close(); }
  expect(readdirSync(workflowDir).filter(n=>/^1-/.test(n))).toEqual([]);
  expect((await f.cli(["report","--run",sameId,"--workflow-run",sameId,"--type","workflow.heartbeat","--payload",f.file({})])).code).toBe(1);
 } finally { await server.stop(); }
}, 60000);
