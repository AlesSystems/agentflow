import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { openOwnedStore } from "../../src/db";
it("actual stopped local CLI backs up, rotates, restores and refuses token output in noninteractive use", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-cli-"));
  const file = join(dir, "backups", "cli.sqlite");
  const owned = await openOwnedStore(dir);
  const original = owned.store.metadata().generation;
  owned.close();
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli/local.ts", ...args],
      { env: { ...process.env, AGENTFLOW_DATA_DIR: dir }, encoding: "utf8" },
    );
  const setup = run(["setup"]);
  expect(setup.status).toBe(1);
  expect(setup.stdout).toBe("");
  expect(setup.stderr).toContain("INTERACTIVE_TERMINAL_REQUIRED");
  expect(run(["backup", "--output", file]).status).toBe(0);
  const old = readFileSync(join(dir, "credentials.json"));
  expect(run(["credentials", "rotate"]).status).toBe(0);
  const current = readFileSync(join(dir, "credentials.json"));
  expect(current).not.toEqual(old);
  expect(run(["restore", "--from", file]).status).toBe(0);
  expect(readFileSync(join(dir, "credentials.json"))).toEqual(current);
  const restored = await openOwnedStore(dir);
  expect(restored.store.metadata().generation).not.toBe(original);
  expect(restored.store.integrity().integrity).toBe("ok");
  restored.close();
});
