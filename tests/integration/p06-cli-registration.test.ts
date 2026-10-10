import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { launch } from "../fixtures/server";

async function cli(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli/main.ts", ...args], {
    env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => stdout += chunk);
  child.stderr.on("data", chunk => stderr += chunk);
  const code = await new Promise<number | null>(resolve => child.on("exit", resolve));
  return { code, stdout, stderr };
}

it("creates through the production public API and replays original registration without exposing private fields", async () => {
  const server = await launch();
  const fixture = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-p06-registration-"));
  const token = join(fixture, "token");
  writeFileSync(token, server.credentials().reporterToken, { mode: 0o600 });
  const file = join(fixture, "project.json");
  const secret = "PRIVATE-P06-REPOSITORY-SENTINEL";
  writeFileSync(file, JSON.stringify({ name: "  Synthetic P06  ", repositoryPath: secret }));
  const env = { PORT: String(server.port), AGENTFLOW_REPORTER_TOKEN_FILE: token, AGENTFLOW_OUTBOX_DIR: join(fixture, "outbox") };
  const key = randomUUID();
  const args = ["project", "create", "--file", file, "--idempotency-key", key];
  try {
    const first = await cli(args, env);
    expect(first.code).toBe(0);
    const output = JSON.parse(first.stdout);
    expect(Object.keys(output).sort()).toEqual(["generation", "id"]);
    expect(first.stdout + first.stderr).not.toContain(secret);
    expect((await cli(args, env)).stdout).toBe(first.stdout);
    const db = new Database(join(server.dir, "agentflow.sqlite"), { readonly: true });
    try {
      expect(db.prepare("SELECT name, repository_path FROM projects WHERE id=?").get(output.id)).toEqual({ name: "Synthetic P06", repository_path: secret });
      expect(db.prepare("SELECT count(*) n FROM projects").get()).toEqual({ n: 1 });
    } finally { db.close(); }
  } finally { await server.stop(); }
});
