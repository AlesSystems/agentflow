import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { migrations, openOwnedStore, type Migration } from "../../src/db";

const candidate = (sql: string): Migration => ({
  id: "9999_fixture",
  sql,
  sha256: createHash("sha256").update(sql).digest("hex"),
});
const trigger = `CREATE TABLE guarded (value INTEGER);
CREATE TRIGGER guard BEFORE INSERT ON guarded WHEN NEW.value < 1
BEGIN SELECT CASE WHEN NEW.value = 0 THEN RAISE(ABORT, 'BEGIN COMMIT END') ELSE RAISE(ABORT, 'invalid') END; END;`;
function inspect(dir: string, operation: (db: Database.Database) => void) {
  const db = new Database(join(dir, "agentflow.sqlite"));
  try {
    operation(db);
  } finally {
    db.close();
  }
}
it("real Store admits trigger BEGIN and CASE END inside the owned migration transaction", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-trigger-"));
  const owned = await openOwnedStore(dir, [...migrations, candidate(trigger)]);
  try {
    inspect(dir, (db) => {
      db.prepare("INSERT INTO guarded VALUES (1)").run();
      expect(() => db.prepare("INSERT INTO guarded VALUES (0)").run()).toThrow(
        "BEGIN COMMIT END",
      );
    });
    expect(owned.store.integrity().integrity).toBe("ok");
  } finally {
    owned.close();
  }
});
it.each([
  "BEGIN",
  "BEGIN IMMEDIATE",
  "COMMIT",
  "END",
  "END TRANSACTION",
  "ROLLBACK",
  "SAVEPOINT x",
  "RELEASE x",
  "VACUUM",
  "ATTACH 'x' AS x",
  "DETACH x",
  "PRAGMA foreign_keys=OFF",
])("rejects top-level %s before mutations", async (control) => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-control-"));
  const old = await openOwnedStore(dir);
  const before = old.store.metadata();
  old.close();
  await expect(
    openOwnedStore(dir, [
      ...migrations,
      candidate(`${trigger} ${control}; CREATE TABLE escaped(x);`),
    ]),
  ).rejects.toThrow("NONTRANSACTIONAL_MIGRATION");
  const reopened = await openOwnedStore(dir);
  try {
    expect(reopened.store.metadata()).toEqual(before);
    inspect(dir, (db) =>
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name IN ('guarded','escaped')",
          )
          .all(),
      ).toEqual([]),
    );
  } finally {
    reopened.close();
  }
});
it("real Store rolls back trigger creation and data when subsequent SQL fails", async () => {
  const dir = mkdtempSync(
    join(realpathSync(tmpdir()), "agentflow-trigger-rollback-"),
  );
  const old = await openOwnedStore(dir);
  old.close();
  await expect(
    openOwnedStore(dir, [
      ...migrations,
      candidate(
        `${trigger} INSERT INTO guarded VALUES(1); INSERT INTO missing VALUES(1);`,
      ),
    ]),
  ).rejects.toThrow();
  inspect(dir, (db) => {
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE name IN ('guarded','guard')",
        )
        .all(),
    ).toEqual([]);
    expect(
      db.prepare("SELECT count(*) n FROM migration_history").get(),
    ).toEqual({ n: migrations.length });
  });
});
it("admits mixed case, comments, quoted identifiers and nested CASE expressions", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-lexical-"));
  const sql = `CREATE TABLE "BEGIN" ("END" TEXT); -- COMMIT;
  INSERT INTO "BEGIN" VALUES ('ROLLBACK '' END'); /* PRAGMA */
  cReAtE tEmPoRaRy tRiGgEr IF NOT EXISTS "COMMIT" AFTER INSERT ON "BEGIN"
  WHEN CASE WHEN NEW."END"='x' THEN 1 ELSE 0 END = 1
  bEgIn SELECT CASE WHEN 1 THEN CASE WHEN 1 THEN 'END' END ELSE 'BEGIN' END; eNd;`;
  const owned = await openOwnedStore(dir, [...migrations, candidate(sql)]);
  try {
    expect(owned.store.integrity().integrity).toBe("ok");
  } finally {
    owned.close();
  }
});
it.each([
  "CREATE TABLE x(a); END;",
  "CREATE TABLE x(a); /* unterminated",
  "CREATE TABLE x(a); 'unterminated",
  'CREATE TABLE "unterminated(a);',
  "CREATE TABLE [unterminated(a);",
  "CREATE TABLE `unterminated(a);",
  "CREATE TABLE x(a); /* nested /* comment */ COMMIT;",
  "CREATE TABLE x(a)\u0000;",
  "CREATE TRIGGER x BEGIN SELECT 1; END;",
  "CREATE TRIGGER x ON guarded BEGIN SELECT 1; END;",
  "CREATE TRIGGER x AFTER INSERT ON guarded BEGIN COMMIT; END;",
  "CREATE TRIGGER x AFTER INSERT ON guarded BEGIN SELECT 1; ROLLBACK; END;",
  "CREATE TRIGGER x AFTER INSERT ON guarded BEGIN SELECT CASE WHEN 1 THEN 1; END;",
  "CREATE TRIGGER x AFTER INSERT ON guarded BEGIN SELECT 1 END;",
  "CREATE TRIGGER x AFTER INSERT ON guarded BEGIN SELECT 1; END",
  "CREATE TRIGGER x AFTER INSERT ON guarded BEGIN SELECT 1; END TRANSACTION;",
  "CREATE TRIGGER x AFTER INSERT ON guarded WHEN BEGIN SELECT 1; END;",
  "CREATE TRIGGER x AFTER INSERT ON guarded BEGIN SELECT 1; END; sAvEpOiNt hidden;",
])("fails closed for malformed or ambiguous SQL %s", async (sql) => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-malformed-"));
  const old = await openOwnedStore(dir);
  old.close();
  await expect(
    openOwnedStore(dir, [...migrations, candidate(sql)]),
  ).rejects.toThrow("NONTRANSACTIONAL_MIGRATION");
  inspect(dir, (db) =>
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name='x'").all(),
    ).toEqual([]),
  );
});
it("SQLite remains authority for syntactically invalid allowed DML and rolls it back", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-parser-"));
  const old = await openOwnedStore(dir);
  old.close();
  await expect(
    openOwnedStore(dir, [
      ...migrations,
      candidate(
        "CREATE TABLE guarded(value); CREATE TRIGGER x AFTER INSERT ON guarded BEGIN SELECT FROM; END;",
      ),
    ]),
  ).rejects.toThrow("syntax error");
  inspect(dir, (db) =>
    expect(
      db.prepare("SELECT name FROM sqlite_schema WHERE name='guarded'").all(),
    ).toEqual([]),
  );
});
it.each([
  "BEGIN",
  "COMMIT",
  "END",
  "END TRANSACTION",
  "ROLLBACK",
  "SAVEPOINT x",
  "RELEASE x",
  "VACUUM",
  "ATTACH 'x' AS x",
  "DETACH x",
  "PRAGMA foreign_keys=OFF",
])("rejects %s before a trigger or within its body", async (control) => {
  for (const sql of [
    `${control}; ${trigger}`,
    `CREATE TABLE guarded(value); CREATE TRIGGER x AFTER INSERT ON guarded BEGIN ${control}; END;`,
  ]) {
    const dir = mkdtempSync(
      join(realpathSync(tmpdir()), "agentflow-control-position-"),
    );
    const old = await openOwnedStore(dir);
    old.close();
    await expect(
      openOwnedStore(dir, [...migrations, candidate(sql)]),
    ).rejects.toThrow("NONTRANSACTIONAL_MIGRATION");
    inspect(dir, (db) =>
      expect(
        db.prepare("SELECT name FROM sqlite_schema WHERE name='guarded'").all(),
      ).toEqual([]),
    );
  }
});
