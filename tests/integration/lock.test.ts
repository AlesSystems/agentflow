import { expect, it } from "vitest";
import { launch, freePort, stop } from "../fixtures/server";
import { startRuntime } from "../../src/server/launcher";
import { readConfig } from "../../src/server/config";
import { mkdtempSync, realpathSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireInstance } from "../../src/server/instance";
it("different-port contender fails; SIGKILL releases the stable OS lock", async () => {
  const first = await launch();
  const inode = lstatSync(join(first.dir, "instance-lock.sqlite")).ino;
  await expect(launch({ dir: first.dir })).rejects.toThrow("INSTANCE_BUSY");
  await stop(first.child, "SIGKILL");
  const next = await launch({ dir: first.dir });
  expect(lstatSync(join(first.dir, "instance-lock.sqlite")).ino).toBe(inode);
  await next.stop();
});
it("retains ownership while an async handler outlives socket shutdown", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-drain-"));
  const port = await freePort();
  let entered!: () => void;
  let release!: () => void;
  const arrived = new Promise<void>((resolve) => (entered = resolve));
  const latch = new Promise<void>((resolve) => (release = resolve));
  const running = await startRuntime(
    readConfig({ PORT: String(port), AGENTFLOW_DATA_DIR: dir }),
    {
      beforeDispatch: async (request) => {
        if (request.url === "/pair") {
          entered();
          await latch;
        }
      },
    },
  );
  const request = fetch(`http://127.0.0.1:${port}/pair`).catch(() => undefined);
  await arrived;
  const closing = running.shutdown();
  await new Promise((resolve) => setTimeout(resolve, 1700));
  expect(() => acquireInstance(dir)).toThrow("INSTANCE_BUSY");
  release();
  await closing;
  await request;
  const contender = acquireInstance(dir);
  contender.release();
});
it("startup listener failure releases ownership after initialized resources close", async () => {
  const first = await launch();
  const dir = mkdtempSync(
    join(realpathSync(tmpdir()), "agentflow-start-failure-"),
  );
  await expect(
    startRuntime(
      readConfig({ PORT: String(first.port), AGENTFLOW_DATA_DIR: dir }),
    ),
  ).rejects.toThrow();
  const owner = acquireInstance(dir);
  owner.release();
  await first.stop();
});
it("simultaneous first launches elect exactly one owner on different ports", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-race-"));
  const results = await Promise.allSettled([launch({ dir }), launch({ dir })]);
  const winners = results.filter((result) => result.status === "fulfilled");
  const losers = results.filter((result) => result.status === "rejected");
  expect(winners).toHaveLength(1);
  expect(losers).toHaveLength(1);
  expect(String(losers[0].status === "rejected" && losers[0].reason)).toContain(
    "INSTANCE_BUSY",
  );
  for (const result of winners)
    if (result.status === "fulfilled") await result.value.stop();
});
