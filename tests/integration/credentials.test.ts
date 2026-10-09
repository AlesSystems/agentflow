import { spawn } from "node:child_process";
import {
  mkdtempSync,
  realpathSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { openOwnedStore } from "../../src/db";
import { hashSecret } from "../../src/server/auth";
async function interrupt(dir: string, phase: string) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "tests/fixtures/maintenance.ts", "rotate", dir, phase],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (data) => {
      if (String(data).includes("phase " + phase)) resolve();
    });
    child.once("exit", () => reject(new Error("fixture exited before phase")));
  });
  const exit = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill("SIGKILL");
  await exit;
}
for (const phase of ["writing", "staged", "revoked", "published"])
  it(`rotation crash at ${phase} preserves one complete credential set and correct sessions`, async () => {
    const dir = mkdtempSync(
      join(realpathSync(tmpdir()), "agentflow-rotation-"),
    );
    let owned = await openOwnedStore(dir);
    const original = owned.credentials;
    owned.store.createSession(
      hashSecret("synthetic-session"),
      1,
      9999999999999,
    );
    owned.close();
    await interrupt(dir, phase);
    owned = await openOwnedStore(dir);
    const current = owned.credentials;
    expect(current.pairingToken).not.toBe(current.reporterToken);
    if (phase === "published") {
      expect(current.pairingToken).not.toBe(original.pairingToken);
      expect(current.reporterToken).not.toBe(original.reporterToken);
    } else expect(current).toEqual(original);
    expect(owned.store.sessionCount()).toBe(
      ["writing", "staged"].includes(phase) ? 1 : 0,
    );
    owned.close();
  });
it("rejects invalid authoritative credentials but removes unpublished partial staging files", async () => {
  const dir = mkdtempSync(
    join(realpathSync(tmpdir()), "agentflow-credentials-"),
  );
  const owned = await openOwnedStore(dir);
  const old = readFileSync(join(dir, "credentials.json"));
  owned.close();
  writeFileSync(
    join(dir, "credentials-stage-00000000-0000-0000-0000-000000000000.json"),
    "{",
    { mode: 0o600 },
  );
  const recovered = await openOwnedStore(dir);
  expect(readFileSync(join(dir, "credentials.json"))).toEqual(old);
  recovered.close();
  writeFileSync(join(dir, "credentials.json"), "{}");
  await expect(openOwnedStore(dir)).rejects.toThrow("INVALID_CREDENTIALS");
  expect(readFileSync(join(dir, "credentials.json"), "utf8")).toBe("{}");
});
it("malformed credential JSON is rejected with a safe repair code", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-json-"));
  const owned = await openOwnedStore(dir);
  owned.close();
  writeFileSync(
    join(dir, "credentials.json"),
    '{"pairingToken":"synthetic-secret',
  );
  await expect(openOwnedStore(dir)).rejects.toThrow("INVALID_CREDENTIALS");
});
