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
export type OwnedBounds = {
  startupMs: number;
  healthMs: number;
  terminateMs: number;
  killMs: number;
};
export async function launch(
  options: {
    dir?: string;
    port?: number;
    plain?: boolean;
    stdin?: boolean;
    cwd?: string;
    entry?: string;
    nodeArgs?: string[];
    extraEnv?: Record<string, string>;
    bounds?: OwnedBounds;
  } = {},
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
      : [
          ...(options.nodeArgs ?? []),
          "--import",
          "tsx",
          options.entry ?? "src/server/launcher.ts",
          "--production",
        ],
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
      stdio: [options.stdin ? "pipe" : "ignore", "pipe", "pipe"],
    },
  );
  let spawnError: Error | undefined;
  if (options.bounds)
    child.once("error", (error) => {
      spawnError = error;
    });
  let logs = "";
  child.stdout!.on("data", (chunk) => (logs += chunk));
  child.stderr!.on("data", (chunk) => (logs += chunk));
  const url = `http://127.0.0.1:${port}`;
  const start = Date.now();
  while (Date.now() - start < (options.bounds?.startupMs ?? 30000)) {
    if (spawnError) {
      await stop(child, "SIGTERM", options.bounds).catch((cleanup) =>
        Object.assign(spawnError!, { cleanupError: String(cleanup) }),
      );
      throw spawnError;
    }
    if (child.exitCode !== null) {
      const primary = new Error(`launch exited ${child.exitCode}: ${logs}`);
      if (options.bounds)
        await stop(child, "SIGTERM", options.bounds).catch((cleanup) =>
          Object.assign(primary, { cleanupError: String(cleanup) }),
        );
      throw primary;
    }
    try {
      const response = await fetch(
        url + "/api/v1/health",
        options.bounds
          ? {
              signal: AbortSignal.timeout(
                Math.max(
                  1,
                  Math.min(
                    options.bounds.healthMs,
                    options.bounds.startupMs - (Date.now() - start),
                  ),
                ),
              ),
            }
          : undefined,
      );
      if (options.bounds) await response.arrayBuffer();
      if (response.ok || options.plain)
        return {
          child,
          dir,
          port,
          url,
          logs: () => logs,
          stop: () => stop(child, "SIGTERM", options.bounds),
          credentials: () =>
            JSON.parse(
              readFileSync(join(dir, "credentials.json"), "utf8"),
            ) as Credentials,
        };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const primary = new Error("launch timeout: " + logs);
  if (options.bounds)
    await stop(child, "SIGTERM", options.bounds).catch((cleanup) =>
      Object.assign(primary, { cleanupError: String(cleanup) }),
    );
  else await stop(child);
  throw primary;
}
export async function stop(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
  bounds?: Pick<OwnedBounds, "terminateMs" | "killMs">,
) {
  if (bounds) {
    if (
      (child.exitCode !== null || child.signalCode !== null) &&
      child.stdio.every(
        (stream) =>
          !stream ||
          typeof stream === "number" ||
          Boolean(
            (stream as { closed?: boolean; destroyed?: boolean }).closed ||
              (stream as { destroyed?: boolean }).destroyed,
          ),
      )
    )
      return;
    const closed = new Promise<void>((resolve) =>
      child.once("close", () => resolve()),
    );
    async function wait(ms: number) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return Promise.race([
        closed.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), ms);
        }),
      ]).finally(() => clearTimeout(timer));
    }
    if (child.exitCode === null && child.signalCode === null)
      child.kill(signal);
    if (await wait(bounds.terminateMs)) return;
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    if (await wait(bounds.killMs)) return;
    for (const stream of child.stdio)
      if (stream && typeof stream !== "number") stream.destroy();
    throw new Error("OWNED_CHILD_STOP_DEADLINE");
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill(signal);
  await exited;
}
export async function pair(
  server: Awaited<ReturnType<typeof launch>>,
  request: typeof fetch = fetch,
) {
  const response = await request(server.url + "/api/v1/session", {
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
