import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { migrations, openOwnedStore, type Migration } from "../../src/db";

const candidate = (sql: string): Migration => ({ id: "9999_fixture", sql, sha256: createHash("sha256").update(sql).digest("hex") });
const trigger = `CREATE TABLE guarded (value INTEGER);
CREATE TRIGGER guard BEFORE INSERT ON guarded WHEN NEW.value < 1
BEGIN SELECT CASE WHEN NEW.value = 0 THEN RAISE(ABORT, 'BEGIN COMMIT END') ELSE RAISE(ABORT, 'invalid') END; END;`;
function inspect(dir: string, operation: (db: Database.Database) => void) {
  const db = new Database(join(dir, "agentflow.sqlite"));
  try { operation(db); } finally { db.close(); }
}
it("real Store admits trigger BEGIN and CASE END inside the owned migration transaction", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-trigger-"));
  const owned = await openOwnedStore(dir, [...migrations, candidate(trigger)]);
  try {
    inspect(dir, db => {
      db.prepare("INSERT INTO guarded VALUES (1)").run();
      expect(() => db.prepare("INSERT INTO guarded VALUES (0)").run()).toThrow("BEGIN COMMIT END");
    });
    expect(owned.store.integrity().integrity).toBe("ok");
  } finally { owned.close(); }
});
it.each(["BEGIN", "BEGIN IMMEDIATE", "COMMIT", "END", "END TRANSACTION", "ROLLBACK", "SAVEPOINT x", "RELEASE x", "VACUUM", "ATTACH 'x' AS x", "DETACH x", "PRAGMA foreign_keys=OFF"])("rejects top-level %s before mutations", async control => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-control-"));
  const old = await openOwnedStore(dir); const before = old.store.metadata(); old.close();
  await expect(openOwnedStore(dir, [...migrations, candidate(`${trigger} ${control}; CREATE TABLE escaped(x);`)])).rejects.toThrow("NONTRANSACTIONAL_MIGRATION");
  const reopened = await openOwnedStore(dir);
  try { expect(reopened.store.metadata()).toEqual(before); inspect(dir, db => expect(db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('guarded','escaped')").all()).toEqual([])); } finally { reopened.close(); }
});
it("real Store rolls back trigger creation and data when subsequent SQL fails", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-trigger-rollback-"));
  const old = await openOwnedStore(dir); old.close();
  await expect(openOwnedStore(dir, [...migrations, candidate(`${trigger} INSERT INTO guarded VALUES(1); INSERT INTO missing VALUES(1);`)])).rejects.toThrow();
  inspect(dir, db => {
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('guarded','guard')").all()).toEqual([]);
    expect(db.prepare("SELECT count(*) n FROM migration_history").get()).toEqual({ n: migrations.length });
  });
});
