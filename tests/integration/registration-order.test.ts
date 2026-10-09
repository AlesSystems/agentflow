import Database from "better-sqlite3";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { migrations, openOwnedStore } from "../../src/db";
const directory = () =>
  mkdtempSync(join(realpathSync(tmpdir()), "agentflow-order-"));
function connection(dir: string, operation: (db: Database.Database) => void) {
  const db = new Database(join(dir, "agentflow.sqlite"));
  db.pragma("foreign_keys=ON");
  try {
    operation(db);
  } finally {
    db.close();
  }
}
function legacy(db: Database.Database) {
  db.exec(`INSERT INTO projects VALUES('10000000-0000-4000-8000-000000000001','Synthetic legacy',NULL,NULL,1,0,0);
    INSERT INTO agents VALUES('10000000-0000-4000-8000-000000000002','Synthetic legacy','fixture','implementation',1,0);
    INSERT INTO tasks VALUES('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',NULL,'Synthetic task','','','review','normal','[]',NULL,NULL,NULL,NULL,NULL,1,1,0,0,NULL);`);
  const insert = db.prepare(
    "INSERT INTO runs(rowid,id,project_id,agent_id,task_id,purpose,work_revision,state,last_sequence,last_received_at,version,created_at) VALUES(?,?, '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',? ,?, ?,?,0,0,1,0)",
  );
  insert.run(
    -10,
    "ffffffff-ffff-4fff-8fff-ffffffffffff",
    "10000000-0000-4000-8000-000000000003",
    "implementation",
    1,
    "succeeded",
  );
  insert.run(
    20,
    "00000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000003",
    "implementation",
    1,
    "failed",
  );
  insert.run(
    80,
    "10000000-0000-4000-8000-000000000004",
    null,
    "planning",
    null,
    "queued",
  );
}
it("upgrades 0001 preserving dense legacy rowid order and all run facts", async () => {
  const dir = directory();
  const old = await openOwnedStore(dir, migrations.slice(0, 2));
  old.close();
  connection(dir, legacy);
  const upgraded = await openOwnedStore(dir);
  try {
    connection(dir, (db) => {
      expect(
        db
          .prepare(
            "SELECT id,registration_order FROM runs ORDER BY registration_order",
          )
          .all(),
      ).toEqual([
        { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", registration_order: 1 },
        { id: "00000000-0000-4000-8000-000000000001", registration_order: 2 },
        { id: "10000000-0000-4000-8000-000000000004", registration_order: 3 },
      ]);
      expect(
        db.prepare("SELECT last_value FROM run_order_allocator").get(),
      ).toEqual({ last_value: 3 });
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name LIKE '%registration_identity%' OR name LIKE '%event%'",
          )
          .all(),
      ).toEqual([]);
    });
    expect(
      upgraded.store.snapshot({
        kind: "task",
        id: "10000000-0000-4000-8000-000000000003",
        input: { history: "both", historyLimit: 50 },
      }).body.data,
    ).toMatchObject({
      latestRun: { id: "00000000-0000-4000-8000-000000000001" },
    });
    expect(upgraded.store.integrity().integrity).toBe("ok");
  } finally {
    upgraded.close();
  }
});

import { nextRegistrationOrder } from "../../src/db/registration-order";
import { restore } from "../../src/db/recovery";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
const taskId = "10000000-0000-4000-8000-000000000003";
const failedId = "00000000-0000-4000-8000-000000000001";
async function upgradedFixture() {
  const dir = directory();
  const old = await openOwnedStore(dir, migrations.slice(0, 2));
  old.close();
  connection(dir, legacy);
  const owned = await openOwnedStore(dir);
  return { dir, owned };
}
function insert(
  db: Database.Database,
  order: unknown,
  id = randomUUID(),
  state = "succeeded",
  revision = 1,
) {
  return db
    .prepare(
      `INSERT INTO runs(id,project_id,agent_id,task_id,purpose,model,work_revision,state,last_sequence,last_received_at,started_at,ended_at,version,created_at,registration_order)
    SELECT ?,project_id,agent_id,task_id,purpose,model,?, ?,last_sequence,last_received_at,started_at,ended_at,version,created_at,? FROM runs WHERE id=?`,
    )
    .run(id, revision, state, order, failedId);
}
function allocate(
  db: Database.Database,
  id = randomUUID(),
  state = "succeeded",
  revision = 1,
) {
  return db
    .transaction(() => {
      const order = nextRegistrationOrder(db);
      insert(db, order, id, state, revision);
      return order;
    })
    .immediate();
}
function highwater(db: Database.Database) {
  return db.prepare("SELECT last_value FROM run_order_allocator").get();
}
function complete(owned: Awaited<ReturnType<typeof openOwnedStore>>) {
  return owned.store.command(
    {
      kind: "task.complete",
      id: taskId,
      input: {
        expectedVersion: 1,
        evidenceNote: "Synthetic acceptance fixture",
      },
    },
    {
      principal: "operator",
      method: "POST",
      path: "/fixture/complete",
      key: randomUUID(),
      digest: "fixture",
      now: 1000,
    },
  );
}
it("effective SQL guards reject invalid, duplicate and changed order without altering high-water", async () => {
  const { dir, owned } = await upgradedFixture();
  try {
    connection(dir, (db) => {
      for (const value of [null, 0, -1, 1.5, "invalid", 9007199254740992, 2]) {
        expect(() => insert(db, value)).toThrow();
        expect(highwater(db)).toEqual({ last_value: 3 });
      }
      expect(() =>
        db
          .prepare("UPDATE runs SET registration_order=4 WHERE id=?")
          .run(failedId),
      ).toThrow("immutable");
      expect(() =>
        db
          .prepare("UPDATE runs SET registration_order=NULL WHERE id=?")
          .run(failedId),
      ).toThrow("immutable");
      db.prepare(
        "UPDATE runs SET registration_order=registration_order WHERE id=?",
      ).run(failedId);
      expect(
        db
          .prepare("SELECT registration_order FROM runs WHERE id=?")
          .get(failedId),
      ).toEqual({ registration_order: 2 });
      expect(allocate(db)).toBe(4);
      expect(() => insert(db, 4)).toThrow();
      expect(highwater(db)).toEqual({ last_value: 4 });
      const schema = db.prepare("PRAGMA table_info(runs)").all() as {
        name: string;
        notnull: number;
      }[];
      expect(schema.find((c) => c.name === "registration_order")?.notnull).toBe(
        0,
      );
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'runs_registration_order_%' ORDER BY name",
          )
          .all(),
      ).toEqual([
        { name: "runs_registration_order_advance" },
        { name: "runs_registration_order_immutable" },
        { name: "runs_registration_order_insert" },
      ]);
    });
  } finally {
    owned.close();
  }
});
it("protects allocator singleton and high-water against insertion deletion reset decrease and overflow", async () => {
  const { dir, owned } = await upgradedFixture();
  try {
    connection(dir, (db) => {
      for (const sql of [
        "INSERT INTO run_order_allocator VALUES(2,4)",
        "INSERT OR REPLACE INTO run_order_allocator VALUES(1,4)",
        "DELETE FROM run_order_allocator",
        "UPDATE run_order_allocator SET singleton=2",
        "UPDATE run_order_allocator SET last_value=0",
        "UPDATE run_order_allocator SET last_value=2",
        "UPDATE run_order_allocator SET last_value=3",
        "UPDATE run_order_allocator SET last_value=3.5",
        "UPDATE run_order_allocator SET last_value=NULL",
        "UPDATE run_order_allocator SET last_value=9007199254740992",
      ]) {
        expect(() => db.exec(sql)).toThrow();
        expect(highwater(db)).toEqual({ last_value: 3 });
      }
      expect(() => nextRegistrationOrder(db)).toThrow("TRANSACTION_REQUIRED");
      db.exec("UPDATE run_order_allocator SET last_value=9007199254740990");
      expect(allocate(db)).toBe(Number.MAX_SAFE_INTEGER);
      expect(() => allocate(db)).toThrow("EXHAUSTED");
      expect(highwater(db)).toEqual({ last_value: 9007199254740991 });
      expect(db.prepare("SELECT count(*) n FROM runs").get()).toEqual({ n: 4 });
    });
  } finally {
    owned.close();
  }
});
it("never reuses deleted highest order and rolls back allocation with failed transaction", async () => {
  const { dir, owned } = await upgradedFixture();
  try {
    connection(dir, (db) => {
      const id = randomUUID();
      expect(allocate(db, id)).toBe(4);
      db.prepare("DELETE FROM runs WHERE id=?").run(id);
      expect(() => insert(db, 4)).toThrow();
      expect(allocate(db)).toBe(5);
      expect(() =>
        db
          .transaction(() => {
            insert(db, nextRegistrationOrder(db));
            throw new Error("injected");
          })
          .immediate(),
      ).toThrow("injected");
      expect(highwater(db)).toEqual({ last_value: 5 });
      expect(allocate(db)).toBe(6);
    });
  } finally {
    owned.close();
  }
});
it("latest implementation failure supersedes tied-timestamp success and current revision remains required", async () => {
  const { dir, owned } = await upgradedFixture();
  try {
    expect(() => complete(owned)).toThrow("implementation_not_current");
    connection(dir, (db) => {
      allocate(db, randomUUID(), "succeeded", 2);
    });
    expect(() => complete(owned)).toThrow("implementation_not_current");
    const current = randomUUID();
    connection(dir, (db) => {
      allocate(db, current, "succeeded", 1);
    });
    expect(
      owned.store.snapshot({
        kind: "task",
        id: taskId,
        input: { history: "both", historyLimit: 50 },
      }).body.data,
    ).toMatchObject({ latestRun: { id: current } });
    expect(complete(owned).body.data).toMatchObject({
      implementationRunId: current,
    });
  } finally {
    owned.close();
  }
});
it("restart VACUUM and reverse insertion rebuild preserve latest queries and retained allocator", async () => {
  const { dir, owned } = await upgradedFixture();
  owned.close();
  connection(dir, (db) => {
    db.exec("VACUUM");
  });
  let reopened = await openOwnedStore(dir);
  expect(() => complete(reopened)).toThrow("implementation_not_current");
  reopened.close();
  connection(dir, (db) => {
    const schema = db
      .prepare(
        "SELECT type,name,sql FROM sqlite_schema WHERE tbl_name='runs' AND sql IS NOT NULL ORDER BY type,name",
      )
      .all() as { type: string; name: string; sql: string }[];
    const table = schema.find((row) => row.type === "table")!;
    db.pragma("foreign_keys=OFF");
    db.transaction(() => {
      db.exec(
        table.sql.replace(/^CREATE TABLE runs/i, "CREATE TABLE runs_rebuild"),
      );
      const columns = (
        db.prepare("PRAGMA table_info(runs)").all() as { name: string }[]
      )
        .map((c) => c.name)
        .join(",");
      db.exec(
        `INSERT INTO runs_rebuild(${columns}) SELECT ${columns} FROM runs ORDER BY registration_order DESC; DROP TABLE runs; ALTER TABLE runs_rebuild RENAME TO runs;`,
      );
      for (const row of schema.filter((row) => row.type !== "table"))
        db.exec(row.sql);
    }).immediate();
    db.pragma("foreign_keys=ON");
    expect(db.prepare("SELECT id FROM runs ORDER BY rowid").all()).toEqual([
      { id: "10000000-0000-4000-8000-000000000004" },
      { id: failedId },
      { id: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
    ]);
    expect(highwater(db)).toEqual({ last_value: 3 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  });
  reopened = await openOwnedStore(dir);
  try {
    expect(
      reopened.store.snapshot({
        kind: "task",
        id: taskId,
        input: { history: "both", historyLimit: 50 },
      }).body.data,
    ).toMatchObject({ latestRun: { id: failedId } });
    expect(() => complete(reopened)).toThrow("implementation_not_current");
    const id = randomUUID();
    connection(dir, (db) => {
      expect(allocate(db, id)).toBe(4);
    });
    expect(complete(reopened).body.data).toMatchObject({
      implementationRunId: id,
    });
    expect(reopened.store.integrity().integrity).toBe("ok");
  } finally {
    reopened.close();
  }
});
it("older backup restores retained high-water and orders under new generation and revokes sessions", async () => {
  const { dir, owned } = await upgradedFixture();
  const generation = owned.store.metadata().generation;
  owned.store.createSession("synthetic-before", 1, 9999999999999);
  const backup = join(dir, "backups", "at-N.sqlite");
  await owned.store.backup(backup);
  const lost = randomUUID();
  connection(dir, (db) => {
    expect(allocate(db, lost)).toBe(4);
    expect(allocate(db)).toBe(5);
  });
  owned.close();
  await restore(dir, backup);
  const restored = await openOwnedStore(dir);
  try {
    expect(restored.store.metadata().generation).not.toBe(generation);
    expect(restored.store.sessionCount()).toBe(0);
    connection(dir, (db) => {
      expect(
        db
          .prepare(
            "SELECT id,registration_order FROM runs ORDER BY registration_order",
          )
          .all(),
      ).toEqual([
        { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", registration_order: 1 },
        { id: failedId, registration_order: 2 },
        { id: "10000000-0000-4000-8000-000000000004", registration_order: 3 },
      ]);
      expect(
        db.prepare("SELECT id FROM runs WHERE id=?").get(lost),
      ).toBeUndefined();
      expect(highwater(db)).toEqual({ last_value: 3 });
      expect(allocate(db)).toBe(4);
      expect(highwater(db)).toEqual({ last_value: 4 });
    });
    expect(restored.store.integrity().integrity).toBe("ok");
  } finally {
    restored.close();
  }
});
for (const marker of [
  "ALTER TABLE runs ADD COLUMN",
  "UPDATE runs SET",
  "CREATE UNIQUE INDEX runs_registration_order",
  "CREATE TABLE run_order_allocator",
  "INSERT INTO run_order_allocator",
  "CREATE TRIGGER run_order_allocator_no_insert",
  "CREATE TRIGGER runs_registration_order_advance",
]) {
  it(`rolls all migration state back after ${marker}`, async () => {
    const dir = directory();
    const old = await openOwnedStore(dir, migrations.slice(0, 2));
    old.close();
    connection(dir, legacy);
    let before: unknown;
    connection(dir, (db) => {
      before = {
        schema: db
          .prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY name")
          .all(),
        runs: db.prepare("SELECT rowid,* FROM runs ORDER BY rowid").all(),
        history: db
          .prepare("SELECT * FROM migration_history ORDER BY id")
          .all(),
        metadata: db.prepare("SELECT * FROM instance_metadata").all(),
      };
    });
    const sql = migrations[2].sql;
    const start = sql.indexOf(marker);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = marker.startsWith("CREATE TRIGGER")
      ? sql.indexOf("END;", start) + 4
      : sql.indexOf(";", start) + 1;
    const failing =
      sql.slice(0, end) + "\nINSERT INTO nonexistent_failure VALUES(1);";
    await expect(
      openOwnedStore(dir, [
        ...migrations.slice(0, 2),
        {
          id: migrations[2].id,
          sql: failing,
          sha256: createHash("sha256").update(failing).digest("hex"),
        },
      ]),
    ).rejects.toThrow("no such table");
    connection(dir, (db) => {
      expect({
        schema: db
          .prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY name")
          .all(),
        runs: db.prepare("SELECT rowid,* FROM runs ORDER BY rowid").all(),
        history: db
          .prepare("SELECT * FROM migration_history ORDER BY id")
          .all(),
        metadata: db.prepare("SELECT * FROM instance_metadata").all(),
      }).toEqual(before);
      expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(db.pragma("foreign_key_check")).toEqual([]);
    });
    const backups = readdirSync(join(dir, "backups")).filter((file) =>
      file.endsWith(".sqlite"),
    );
    expect(backups).toHaveLength(1);
    const saved = new Database(join(dir, "backups", backups[0]), {
      readonly: true,
    });
    try {
      expect(saved.prepare("SELECT count(*) n FROM runs").get()).toEqual({
        n: 3,
      });
      expect(saved.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally {
      saved.close();
    }
    const valid = await openOwnedStore(dir);
    valid.close();
  });
}
it("keeps the reviewed historical migration bytes unchanged", () => {
  expect(
    createHash("sha256")
      .update(readFileSync("migrations/0001_application.sql"))
      .digest("hex"),
  ).toBe("6a11176b457b764a31232a39a1a37b48996748632a22a6133fff3383912e5a3f");
});
it("preserves linked active, terminal and taskless legacy facts without inventing registration identity", async () => {
  const dir = directory();
  const old = await openOwnedStore(dir, migrations.slice(0, 2));
  old.close();
  let facts: unknown;
  connection(dir, (db) => {
    legacy(db);
    db.exec(`INSERT INTO tasks SELECT '10000000-0000-4000-8000-000000000005',project_id,parent_task_id,title,description,acceptance_criteria,status,priority,tags,assigned_agent_id,target_role,branch,pull_request_url,blocked_reason,version,work_revision,created_at,updated_at,completed_at FROM tasks;
      INSERT INTO runs SELECT '10000000-0000-4000-8000-000000000006',project_id,agent_id,'10000000-0000-4000-8000-000000000005',purpose,model,work_revision,'running',2,100,50,NULL,3,0 FROM runs WHERE id='00000000-0000-4000-8000-000000000001';
      INSERT INTO runs SELECT '10000000-0000-4000-8000-000000000007',project_id,agent_id,NULL,'planning',model,NULL,'cancelled',1,200,NULL,200,2,0 FROM runs WHERE id='00000000-0000-4000-8000-000000000001';`);
    facts = db.prepare("SELECT * FROM runs ORDER BY rowid").all();
  });
  const upgraded = await openOwnedStore(dir);
  try {
    connection(dir, (db) => {
      const rows = db
        .prepare("SELECT * FROM runs ORDER BY registration_order")
        .all() as Record<string, unknown>[];
      expect(
        rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).filter(
              ([name]) => name !== "registration_order",
            ),
          ),
        ),
      ).toEqual(facts);
      expect(rows.map((row) => row.registration_order)).toEqual([
        1, 2, 3, 4, 5,
      ]);
      expect(db.prepare("SELECT count(*) n FROM receipts").get()).toEqual({
        n: 0,
      });
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name LIKE '%registration_identity%' OR name LIKE '%event%'",
          )
          .all(),
      ).toEqual([]);
    });
    expect(upgraded.store.integrity().integrity).toBe("ok");
  } finally {
    upgraded.close();
  }
});

it("rejects replace attempts that would change an existing run identity's immutable order", async () => {
  const { dir, owned } = await upgradedFixture();
  try {
    connection(dir, (db) => {
      expect(() =>
        db.exec(
          `INSERT OR REPLACE INTO runs SELECT id,project_id,agent_id,task_id,purpose,model,work_revision,state,last_sequence,last_received_at,started_at,ended_at,version,created_at,4 FROM runs WHERE id='${failedId}'`,
        ),
      ).toThrow();
      expect(highwater(db)).toEqual({ last_value: 3 });
      expect(
        db
          .prepare("SELECT registration_order FROM runs WHERE id=?")
          .get(failedId),
      ).toEqual({ registration_order: 2 });
    });
  } finally {
    owned.close();
  }
});
it("rejects UPSERT bypasses of run order and allocator high-water", async () => {
  const { dir, owned } = await upgradedFixture();
  try {
    connection(dir, (db) => {
      expect(() =>
        db.exec(
          `INSERT INTO runs SELECT id,project_id,agent_id,task_id,purpose,model,work_revision,state,last_sequence,last_received_at,started_at,ended_at,version,created_at,4 FROM runs WHERE id='${failedId}' ON CONFLICT(id) DO UPDATE SET registration_order=excluded.registration_order`,
        ),
      ).toThrow();
      for (const value of [0, 2, 4]) {
        expect(() =>
          db
            .prepare(
              "INSERT INTO run_order_allocator VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET last_value=excluded.last_value",
            )
            .run(value),
        ).toThrow();
      }
      expect(highwater(db)).toEqual({ last_value: 3 });
      expect(
        db
          .prepare("SELECT registration_order FROM runs WHERE id=?")
          .get(failedId),
      ).toEqual({ registration_order: 2 });
    });
    const detail = owned.store.snapshot({
      kind: "task",
      id: taskId,
      input: { history: "both", historyLimit: 50 },
    }).body.data as { latestRun: Record<string, unknown> };
    expect(detail.latestRun).not.toHaveProperty("registrationOrder");
    expect(detail.latestRun).not.toHaveProperty("registration_order");
  } finally {
    owned.close();
  }
});

it("fresh Store starts allocator at zero and seed fixtures allocate explicit named-column order", async () => {
  const dir = directory();
  const owned = await openOwnedStore(dir);
  try {
    connection(dir, (db) => {
      expect(highwater(db)).toEqual({ last_value: 0 });
      expect(db.prepare("SELECT count(*) n FROM runs").get()).toEqual({ n: 0 });
    });
    const reply = owned.store.command(
      { kind: "project.create", input: { name: "Synthetic fresh fixture" } },
      {
        principal: "operator",
        method: "POST",
        path: "/api/v1/projects",
        key: randomUUID(),
        digest: "synthetic-fresh",
        now: 0,
      },
    );
    const projectId = (reply.body.data as { id: string }).id;
    const { seedRun } = await import("../fixtures/application");
    const first = seedRun(owned.instance, { projectId, state: "cancelled" });
    const second = seedRun(owned.instance, { projectId, state: "queued" });
    connection(dir, (db) => {
      expect(
        db
          .prepare(
            "SELECT id,registration_order FROM runs ORDER BY registration_order",
          )
          .all(),
      ).toEqual([
        { id: first.id, registration_order: 1 },
        { id: second.id, registration_order: 2 },
      ]);
      expect(highwater(db)).toEqual({ last_value: 2 });
    });
    expect(owned.store.integrity().integrity).toBe("ok");
  } finally {
    owned.close();
  }
});
