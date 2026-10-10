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
