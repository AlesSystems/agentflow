import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { openOwnedStore, migrations, type Migration } from "../../src/db";
for (const checkpoint of [
  "CREATE TABLE run_events",
  "CREATE TRIGGER run_events_no_update",
  "CREATE TRIGGER run_closures_no_replace",
])
  it(`rolls Stage2 additive migration back after ${checkpoint}`, async () => {
    const dir = mkdtempSync(
      join(realpathSync(tmpdir()), "agentflow-p04-migration-"),
    );
    const prefix = migrations.slice(0, 4);
    const owned = await openOwnedStore(dir, prefix);
    owned.close();
    const inspect = () => {
      const db = new Database(join(dir, "agentflow.sqlite"), {
        readonly: true,
      });
      try {
        return {
          schema: db
            .prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY name")
            .all(),
          history: db
            .prepare("SELECT * FROM migration_history ORDER BY id")
            .all(),
          metadata: db.prepare("SELECT * FROM instance_metadata").get(),
          allocator: db.prepare("SELECT * FROM run_order_allocator").get(),
        };
      } finally {
        db.close();
      }
    };
    const before = inspect();
    const original = migrations[4];
    const start = original.sql.indexOf(checkpoint);
    const end = checkpoint.startsWith("CREATE TRIGGER")
      ? original.sql.indexOf("END;", start) + 4
      : original.sql.indexOf(";", start) + 1;
    const sql =
      original.sql.slice(0, end) +
      "\nINSERT INTO missing_failure_" +
      randomUUID().replaceAll("-", "") +
      " VALUES(1);";
    const failing: Migration = {
      id: original.id,
      sql,
      sha256: createHash("sha256").update(sql).digest("hex"),
    };
    await expect(openOwnedStore(dir, [...prefix, failing])).rejects.toThrow();
    expect(inspect()).toEqual(before);
    const upgraded = await openOwnedStore(dir);
    try {
      expect(upgraded.store.integrity()).toEqual({
        integrity: "ok",
        foreignKeys: [],
      });
      expect(upgraded.store.metadata().schemaVersion).toBe(migrations.length);
    } finally {
      upgraded.close();
    }
  });
it("enforces append-only registration, event and human closure facts in effective SQLite", async () => {
  const dir = mkdtempSync(
    join(realpathSync(tmpdir()), "agentflow-p04-fact-guards-"),
  );
  const owned = await openOwnedStore(dir);
  const unregister = owned.instance.registerConnection();
  const db = new Database(join(dir, "agentflow.sqlite"));
  try {
    const p = randomUUID(),
      a = randomUUID(),
      r = randomUUID(),
      e = randomUUID(),
      c = randomUUID();
    db.pragma("foreign_keys=ON");
    db.prepare(
      "INSERT INTO projects VALUES(?,'Synthetic',NULL,NULL,1,0,0)",
    ).run(p);
    db.prepare(
      "INSERT INTO agents VALUES(?,'Synthetic','fixture','implementation',1,0)",
    ).run(a);
    db.prepare(
      "INSERT INTO runs(id,project_id,agent_id,purpose,state,last_sequence,last_received_at,version,created_at,registration_order) VALUES(?,?,?,'planning','interrupted',1,0,1,0,1)",
    ).run(r, p, a);
    db.prepare("INSERT INTO run_registrations VALUES(?,?,?)").run(
      r,
      "digest",
      "{}",
    );
    db.prepare(
      "INSERT INTO run_events VALUES(?,?,1,'run.started','digest','{}','{}',0,0)",
    ).run(e, r);
    db.prepare(
      "INSERT INTO run_closures VALUES(?,?,'Synthetic','operator',0)",
    ).run(c, r);
    for (const table of ["run_registrations", "run_events", "run_closures"]) {
      const before = db.prepare(`SELECT * FROM ${table}`).all();
      expect(() => db.exec(`DELETE FROM ${table}`)).toThrow("immutable");
      expect(() =>
        db.exec(
          `UPDATE ${table} SET ${table === "run_closures" ? "reason" : "body"}='{}'`,
        ),
      ).toThrow("immutable");
      expect(() =>
        db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`),
      ).toThrow("immutable");
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual(before);
    }
    expect(db.pragma("foreign_key_check")).toEqual([]);
  } finally {
    db.close();
    unregister();
    owned.close();
  }
});
