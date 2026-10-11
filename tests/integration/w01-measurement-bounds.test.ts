import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  boundedFetch,
  readBoundedText,
  boundedLaunch,
  boundedProxy,
} from "../fixtures/w01-runtime";
import { stop } from "../fixtures/server";
it("aborts a stalled owned HTTP body and retains its decoded prefix", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200);
    res.write("original partial body");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("owned test listener required");
  let partial = "";
  const started = performance.now();
  try {
    await expect(
      (async () => {
        const reply = await boundedFetch(
          `http://127.0.0.1:${address.port}`,
          {},
          100,
        );
        await readBoundedText(reply, (text) => (partial = text));
      })(),
    ).rejects.toThrow();
    expect(partial).toBe("original partial body");
    expect(performance.now() - started).toBeLessThan(2000);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it("escalates only its owned SIGTERM-resistant child and drains closure", async () => {
  const child = spawn(
    process.execPath,
    ["tests/fixtures/w01-stubborn-service.mjs"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise<void>((resolve) =>
    child.stdout.once("data", () => resolve()),
  );
  const started = performance.now();
  try {
    await stop(child, "SIGTERM", { terminateMs: 100, killMs: 1000 });
    expect(child.signalCode).toBe("SIGKILL");
    expect(child.stdout.closed && child.stderr.closed).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise<void>((resolve) =>
        child.once("close", () => resolve()),
      );
    }
  }
});
it("bounds stalled health requests and closes the owned launch process", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agentflow-w01-health-")),
    started = performance.now();
  await expect(
    boundedLaunch({
      dir,
      entry: "tests/fixtures/w01-stalled-health.mjs",
      bounds: { startupMs: 300, healthMs: 100, terminateMs: 100, killMs: 1000 },
    }),
  ).rejects.toThrow("launch timeout");
  expect(performance.now() - started).toBeLessThan(2000);
  const pid = Number(readFileSync(join(dir, "owned-health-pid"), "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
});

it("aborts and settles in-flight upstream work before closing its owned proxy", async () => {
  const upstream = createServer((_req, res) => {
    res.writeHead(200);
    res.write("partial proxy body");
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const address = upstream.address();
  if (!address || typeof address === "string")
    throw new Error("owned listener required");
  let arrived!: () => void;
  const ingress = new Promise<void>((resolve) => (arrived = resolve));
  const proxy = await boundedProxy(
    { url: `http://127.0.0.1:${address.port}` },
    () => {
      arrived();
      return undefined;
    },
    { httpMs: 200, closeMs: 1000 },
  );
  const request = boundedFetch(`http://127.0.0.1:${proxy.port}`, {}, 500)
    .then((response) => readBoundedText(response))
    .catch((error) => error);
  try {
    await ingress;
    const started = performance.now();
    await proxy.close();
    await request;
    expect(proxy.inFlight()).toBe(0);
    expect(performance.now() - started).toBeLessThan(2000);
  } finally {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
