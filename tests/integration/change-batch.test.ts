import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { openOwnedStore } from "../../src/db";
it("replays bounded committed changes without rounding or held transactions and rolls back exhausted commands", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-stream-batch-"));
  const owned = await openOwnedStore(dir);
  const unregister = owned.instance.registerConnection();
  const db = new Database(join(dir, "agentflow.sqlite"));
  try {
    const send = (command: Parameters<typeof owned.store.command>[0]) => owned.store.command(command, { principal: "operator", method: "POST", path: command.kind, key: randomUUID(), digest: "synthetic", now: 0 });
    const projectId = (send({ kind: "project.create", input: { name: "before exhaustion" } }).body.data as { id: string }).id;
    const taskId = (send({ kind: "task.create", input: { projectId, title: "before exhaustion" } }).body.data as { id: string }).id;
    send({ kind: "task.patch", id: taskId, input: { expectedVersion: 1, status: "review" } });
    const insert = db.prepare("INSERT INTO changes(cursor,entity_type,entity_id,kind,received_at) VALUES(CAST(? AS INTEGER),'task','synthetic','updated',0)");
    for (const id of ["9007199254740991", "9007199254740992", "9007199254740993", "9223372036854775806", "9223372036854775807"]) insert.run(id);
    expect(owned.store.changeBatch("9007199254740991").changes.map(c => c.id)).toEqual(["9007199254740992", "9007199254740993", "9223372036854775806", "9223372036854775807"]);
    expect(owned.store.changeBatch("0").maximum).toBe("9223372036854775807");
    expect(() => owned.store.changeBatch("9223372036854775808")).toThrow();
    expect(db.inTransaction).toBe(false);
    const before = ["projects", "tasks", "completions", "receipts", "changes"].map(t => db.prepare(`SELECT count(*) AS n FROM ${t}`).get());
    expect(() => owned.store.command({ kind: "project.create", input: { name: "must roll back" } }, { principal: "operator", method: "POST", path: "/projects", key: randomUUID(), digest: "synthetic", now: 0 })).toThrow();
    expect(["projects", "tasks", "completions", "receipts", "changes"].map(t => db.prepare(`SELECT count(*) AS n FROM ${t}`).get())).toEqual(before);
    expect(() => send({ kind: "task.complete", id: taskId, input: { expectedVersion: 2, evidenceNote: "must roll back" } })).toThrow();
    expect(["projects", "tasks", "completions", "receipts", "changes"].map(t => db.prepare(`SELECT count(*) AS n FROM ${t}`).get())).toEqual(before);
    expect((db.prepare("SELECT version,status FROM tasks WHERE id=?").get(taskId))).toEqual({ version: 2, status: "review" });
    db.prepare("UPDATE settings SET timezone='UTC'").run();
  } finally { db.close(); unregister(); owned.close(); rmSync(dir, { recursive: true }); }
});
