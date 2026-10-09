import { realpathSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { openOwnedStore, migrations } from "../../src/db";
import { restore, repairRestore } from "../../src/db/recovery";

it("restores a WAL-aware integrity backup with new generation and no sessions", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-recovery-"));
  let owned = await openOwnedStore(dir);
  owned.store.createSession("before", 1, 9999999999999);
  const before = owned.store.metadata();
  const tokens = readFileSync(join(dir, "credentials.json"));
  const backup = join(dir, "backups", "known.sqlite");
  await owned.store.backup(backup);
  owned.store.createSession("after", 1, 9999999999999);
  owned.close();
  const receipt = await restore(dir, backup);
  expect(receipt.generation).not.toBe(before.generation);
  expect(receipt.damagedBundle).toBeTruthy();
  owned = await openOwnedStore(dir);
  expect(owned.store.sessionCount()).toBe(0);
  expect(readFileSync(join(dir, "credentials.json"))).toEqual(tokens);
  expect(owned.store.integrity().integrity).toBe("ok");
  owned.close();
});
it("rolls failed migration DDL and history back without serving", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-migrate-"));
  const owned = await openOwnedStore(dir);
  owned.store.createSession("kept", 1, 9999999999999);
  owned.close();
  const sql =
    "CREATE TABLE must_rollback (id TEXT); INSERT INTO absent VALUES (1);";
  await expect(
    openOwnedStore(dir, [
      ...migrations,
      {
        id: "0001_failure",
        sql,
        sha256: createHash("sha256").update(sql).digest("hex"),
      },
    ]),
  ).rejects.toThrow();
  const reopened = await openOwnedStore(dir);
  expect(reopened.store.sessionCount()).toBe(1);
  expect(reopened.store.metadata().schemaVersion).toBe(1);
  expect(reopened.store.validateMigrations()).toEqual(["0000_foundation"]);
  reopened.close();
});
for (const phase of ["staged", "archived", "replaced"] as const)
  it(`restore interrupted at ${phase} fails closed and explicit repair converges`, async () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-crash-"));
    const owned = await openOwnedStore(dir);
    const backup = join(dir, "backups", "known.sqlite");
    await owned.store.backup(backup);
    owned.close();
    await expect(
      restore(dir, backup, (at) => {
        if (at === phase) throw new Error("interrupted");
      }),
    ).rejects.toThrow("interrupted");
    expect(existsSync(join(dir, "restore-marker.json"))).toBe(true);
    await expect(openOwnedStore(dir)).rejects.toThrow("RESTORE_INTERRUPTED");
    await repairRestore(dir);
    const repaired = await openOwnedStore(dir);
    expect(repaired.store.sessionCount()).toBe(0);
    repaired.close();
  });
it("active service ownership prevents restore and backup overwrite is refused", async () => {
  const dir = mkdtempSync(
    join(realpathSync(tmpdir()), "agentflow-restore-lock-"),
  );
  const owned = await openOwnedStore(dir);
  const file = join(dir, "backups", "snapshot.sqlite");
  await owned.store.backup(file);
  await expect(restore(dir, file)).rejects.toThrow("INSTANCE_BUSY");
  await expect(owned.store.backup(file)).rejects.toThrow();
  owned.close();
});
it("rejects checksum drift and nontransactional migrations before altering state", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-schema-"));
  const owned = await openOwnedStore(dir);
  const generation = owned.store.metadata().generation;
  owned.close();
  await expect(
    openOwnedStore(dir, [{ ...migrations[0], sha256: "changed" }]),
  ).rejects.toThrow("MIGRATION_CHECKSUM");
  const sql = "VACUUM;";
  await expect(
    openOwnedStore(dir, [
      ...migrations,
      {
        id: "0001_vacuum",
        sql,
        sha256: createHash("sha256").update(sql).digest("hex"),
      },
    ]),
  ).rejects.toThrow("NONTRANSACTIONAL");
  const recovered = await openOwnedStore(dir);
  expect(recovered.store.metadata().generation).toBe(generation);
  recovered.close();
});
for (const phase of ["staged", "archived", "replaced"])
  it(`SIGKILL at restore ${phase} keeps crash marker and repairs safely`, async () => {
    const { spawn } = await import("node:child_process");
    const dir = mkdtempSync(
      join(realpathSync(tmpdir()), "agentflow-restore-kill-"),
    );
    const owned = await openOwnedStore(dir);
    const backup = join(dir, "backups", "known.sqlite");
    const generation = owned.store.metadata().generation;
    await owned.store.backup(backup);
    owned.close();
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "tests/fixtures/maintenance.ts",
        "restore",
        dir,
        phase,
        backup,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        if (String(chunk).includes("phase " + phase)) resolve();
      });
      child.once("exit", () =>
        reject(new Error("fixture exited before phase")),
      );
    });
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    child.kill("SIGKILL");
    await exited;
    await expect(openOwnedStore(dir)).rejects.toThrow("RESTORE_INTERRUPTED");
    await repairRestore(dir);
    const restored = await openOwnedStore(dir);
    expect(restored.store.metadata().generation).not.toBe(generation);
    expect(restored.store.sessionCount()).toBe(0);
    expect(restored.store.integrity().integrity).toBe("ok");
    restored.close();
  });
it("WAL backup retains earlier synthetic rows and restore loses only known later rows", async () => {
  const Database = (await import("better-sqlite3")).default;
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-wal-"));
  const owned = await openOwnedStore(dir);
  const fixture = new Database(join(dir, "agentflow.sqlite"));
  fixture.exec(
    "CREATE TABLE recovery_fixture (note TEXT); INSERT INTO recovery_fixture VALUES ('before backup');",
  );
  const backup = join(dir, "backups", "wal.sqlite");
  await owned.store.backup(backup);
  fixture.exec("INSERT INTO recovery_fixture VALUES ('after backup');");
  fixture.close();
  owned.close();
  await restore(dir, backup);
  const inspected = new Database(join(dir, "agentflow.sqlite"), {
    readonly: true,
  });
  expect(inspected.prepare("SELECT note FROM recovery_fixture").all()).toEqual([
    { note: "before backup" },
  ]);
  inspected.close();
});
