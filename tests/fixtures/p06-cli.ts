import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { launch } from "./server";
export function cliFixture(server: Awaited<ReturnType<typeof launch>>) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-p06-"));
  const token = join(dir, "token");
  writeFileSync(token, server.credentials().reporterToken, { mode: 0o600 });
  const env = { PORT: String(server.port), AGENTFLOW_REPORTER_TOKEN_FILE: token, AGENTFLOW_OUTBOX_DIR: join(dir,"outbox") };
  let count = 0;
  return {
    dir, env,
    file(value: unknown) { const path = join(dir,`input-${count++}.json`); writeFileSync(path,JSON.stringify(value), { mode: 0o600 }); return path; },
    async cli(args: string[], overrides: Record<string,string | undefined> = {}) {
      const child = spawn(process.execPath, ["--import","tsx","src/cli/main.ts",...args], { env: {...process.env,...env,...overrides}, stdio: ["ignore","pipe","pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", chunk => stdout += chunk);
      child.stderr.on("data", chunk => stderr += chunk);
      const code = await new Promise<number | null>(resolve => child.on("exit",resolve));
      return {code,stdout,stderr};
    },
  };
}
export async function registeredRun(server: Awaited<ReturnType<typeof launch>>) {
  const { randomUUID } = await import("node:crypto");
  const fixture = cliFixture(server);
  async function register(args: string[],body: unknown) {
    const result = await fixture.cli([...args,"--file",fixture.file(body),"--idempotency-key",randomUUID()]);
    if (result.code !== 0) throw new Error("fixture registration failed");
    return JSON.parse(result.stdout).id as string;
  }
  const projectId = await register(["project","create"],{name:"Synthetic"});
  const agentId = await register(["agent","register"],{displayName:"Synthetic",source:"fixture",defaultRole:"implementation"});
  const runId = await register(["run","register"],{id:randomUUID(),projectId,agentId,purpose:"planning"});
  return {...fixture,runId,projectId,agentId};
}
