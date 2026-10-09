import { spawn, type ChildProcess } from "node:child_process";
import { realpathSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { Credentials } from "../../src/server/auth";
export async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
export async function launch(
  options: { dir?: string; port?: number; plain?: boolean; cwd?: string; entry?: string; extraEnv?: Record<string,string> } = {},
) {
  const dir =
    options.dir || mkdtempSync(join(realpathSync(tmpdir()), "agentflow-http-"));
  const port = options.port || (await freePort());
  const cwd = options.cwd || process.cwd();
  const child = spawn(
    process.execPath,
    options.plain
      ? [
          "node_modules/next/dist/bin/next",
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
        ]
      : ["--import", "tsx", options.entry ?? "src/server/launcher.ts", "--production"],
    {
      cwd,
      env: {
        ...process.env,
        ...options.extraEnv,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        AGENTFLOW_DATA_DIR: dir,
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  child.stdout.on("data", (chunk) => (logs += chunk));
  child.stderr.on("data", (chunk) => (logs += chunk));
  const url = `http://127.0.0.1:${port}`;
  const start = Date.now();
  while (Date.now() - start < 30000) {
    if (child.exitCode !== null)
      throw new Error(`launch exited ${child.exitCode}: ${logs}`);
    try {
      const response = await fetch(url + "/api/v1/health");
      if (response.ok || options.plain)
        return {
          child,
          dir,
          port,
          url,
          logs: () => logs,
          stop: () => stop(child),
          credentials: () =>
            JSON.parse(
              readFileSync(join(dir, "credentials.json"), "utf8"),
            ) as Credentials,
        };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await stop(child);
  throw new Error("launch timeout: " + logs);
}
export async function stop(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
) {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill(signal);
  await exited;
}
export async function pair(server: Awaited<ReturnType<typeof launch>>) {
  const response = await fetch(server.url + "/api/v1/session", {
    method: "POST",
    headers: { Origin: server.url, "Content-Type": "application/json" },
    body: JSON.stringify({ token: server.credentials().pairingToken }),
  });
  if (response.status !== 200)
    throw new Error(
      "pair status " + response.status + " " + (await response.text()),
    );
  return response.headers.get("set-cookie")!.split(";")[0];
}
