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
it("adds indexed case-insensitive lookup without merging collisions and rolls a failed 0005 back", async () => {
  const dir = mkdtempSync(
    join(realpathSync(tmpdir()), "agentflow-p04-case-index-"),
  );
  const prefix = migrations.slice(0, 5);
  const owned = await openOwnedStore(dir, prefix);
  owned.close();
  const db = new Database(join(dir, "agentflow.sqlite"));
  const id = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  db.prepare(
    "INSERT INTO agents VALUES(?,'Synthetic','legacy','implementation',1,0)",
  ).run(id);
  db.prepare(
    "INSERT INTO agents VALUES(?,'Other','legacy','implementation',1,0)",
  ).run(id.toLowerCase());
  const before = {
    rows: db.prepare("SELECT * FROM agents ORDER BY id").all(),
    schema: db
      .prepare("SELECT name,sql FROM sqlite_schema ORDER BY name")
      .all(),
    history: db.prepare("SELECT * FROM migration_history ORDER BY id").all(),
    metadata: db.prepare("SELECT * FROM instance_metadata").all(),
  };
  db.close();
  const original = migrations[5];
  const sql = original.sql + "\nINSERT INTO missing_case_failure VALUES(1);";
  await expect(
    openOwnedStore(dir, [
      ...prefix,
      {
        id: original.id,
        sql,
        sha256: createHash("sha256").update(sql).digest("hex"),
      },
    ]),
  ).rejects.toThrow();
  const check = new Database(join(dir, "agentflow.sqlite"), { readonly: true });
  expect({
    rows: check.prepare("SELECT * FROM agents ORDER BY id").all(),
    schema: check
      .prepare("SELECT name,sql FROM sqlite_schema ORDER BY name")
      .all(),
    history: check.prepare("SELECT * FROM migration_history ORDER BY id").all(),
    metadata: check.prepare("SELECT * FROM instance_metadata").all(),
  }).toEqual(before);
  check.close();
  const upgraded = await openOwnedStore(dir);
  const unregister = upgraded.instance.registerConnection();
  const inspect = new Database(join(dir, "agentflow.sqlite"), {
    readonly: true,
  });
  try {
    expect(inspect.prepare("SELECT * FROM agents ORDER BY id").all()).toEqual(
      before.rows,
    );
    expect(() =>
      upgraded.store.snapshot({ kind: "agent", id: id.toLowerCase() }, 1000),
    ).toThrow("identity_ambiguous");
    for (const [table, column, index] of [
      ["projects", "id", "projects_id_case"],
      ["tasks", "id", "tasks_id_case"],
      ["agents", "id", "agents_id_case"],
      ["runs", "id", "runs_id_case"],
      ["run_events", "event_id", "run_events_id_case"],
    ])
      expect(
        JSON.stringify(
          inspect
            .prepare(
              `EXPLAIN QUERY PLAN SELECT * FROM ${table} WHERE ${column}=? COLLATE NOCASE LIMIT 2`,
            )
            .all(id),
        ),
      ).toContain(index);
  } finally {
    inspect.close();
    unregister();
    upgraded.close();
  }
});
