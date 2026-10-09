import {
  realpathSync,
  mkdtempSync,
  chmodSync,
  symlinkSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openOwnedStore } from "../../src/db/index";

describe("owned SQLite foundation", () => {
  it("persists committed sessions and rolls back transactions with real pragmas", async () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-"));
    const owner = await openOwnedStore(dir);
    expect(owner.store.pragmas()).toEqual({
      journal_mode: "wal",
      synchronous: 2,
      foreign_keys: 1,
      busy_timeout: 250,
    });
    const generation = owner.store.metadata().generation;
    owner.store.createSession("hash-one", 1000, 2000);
    expect(() =>
      owner.store.transaction(() => {
        owner.store.createSession("hash-two", 1000, 2000);
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    expect(owner.store.session("hash-two", 1500)).toBeNull();
    owner.close();
    const reopened = await openOwnedStore(dir);
    expect(reopened.store.metadata().generation).toBe(generation);
    expect(reopened.store.session("hash-one", 1500)?.principal).toBe(
      "operator",
    );
    expect(reopened.store.integrity()).toEqual({
      integrity: "ok",
      foreignKeys: [],
    });
    reopened.close();
  });
  it("refuses a competing owner while preserving credentials and stable lock inode", async () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-"));
    const first = await openOwnedStore(dir);
    const tokens = readFileSync(join(dir, "credentials.json"));
    await expect(openOwnedStore(dir)).rejects.toThrow("INSTANCE_BUSY");
    expect(readFileSync(join(dir, "credentials.json"))).toEqual(tokens);
    first.close();
    const second = await openOwnedStore(dir);
    second.close();
  });
  it("refuses unsafe modes and symlink directory without changing files", async () => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-"));
    chmodSync(dir, 0o755);
    await expect(openOwnedStore(dir)).rejects.toThrow("UNSAFE_PERMISSIONS");
    chmodSync(dir, 0o700);
    const alias = dir + "-alias";
    symlinkSync(dir, alias);
    await expect(openOwnedStore(alias)).rejects.toThrow("SYMLINK");
  });
});
it("a competing write returns within the busy timeout and leaves no lingering transaction", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-busy-"));
  const owned = await openOwnedStore(dir);
  const Database = (await import("better-sqlite3")).default;
  const contender = new Database(join(dir, "agentflow.sqlite"));
  contender.exec("BEGIN IMMEDIATE");
  const start = Date.now();
  expect(() => owned.store.createSession("busy", 1, 9999999999999)).toThrow();
  expect(Date.now() - start).toBeGreaterThanOrEqual(200);
  expect(Date.now() - start).toBeLessThan(1500);
  contender.exec("ROLLBACK");
  contender.close();
  owned.store.createSession("after-busy", 1, 9999999999999);
  expect(owned.store.sessionCount()).toBe(1);
  owned.close();
});
it("managed database and credential symlinks and permissive files fail without changes", async () => {
  for (const name of [
    "agentflow.sqlite",
    "credentials.json",
    "instance-lock.sqlite",
  ]) {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-symlink-"));
    const target = join(dir, "target");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(target, "synthetic", { mode: 0o600 });
    symlinkSync(target, join(dir, name));
    await expect(openOwnedStore(dir)).rejects.toThrow("SYMLINK");
    expect(readFileSync(target, "utf8")).toBe("synthetic");
  }
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-mode-"));
  const owned = await openOwnedStore(dir);
  owned.close();
  chmodSync(join(dir, "credentials.json"), 0o644);
  await expect(openOwnedStore(dir)).rejects.toThrow("UNSAFE_PERMISSIONS");
});
it("cannot release ownership while an application connection remains open", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-owner-"));
  const owned = await openOwnedStore(dir);
  expect(() => owned.instance.release()).toThrow("CONNECTIONS_OPEN");
  owned.close();
});
