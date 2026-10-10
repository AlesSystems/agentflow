import { spawn } from "node:child_process";
import { expect, it } from "vitest";
it("proves production native incremental writes, real TCP pressure, auth invalidation, admission and cleanup", async () => {
  const child = spawn(process.execPath, ["--expose-gc", "--import", "tsx", "tests/fixtures/p05-transport.ts"], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", c => output += c);
  child.stderr.on("data", c => output += c);
  const timeout = setTimeout(() => child.kill("SIGKILL"), 45000);
  const code = await new Promise<number | null>(resolve => child.once("exit", resolve));
  clearTimeout(timeout);
  expect(code, output).toBe(0);
  expect(output).toContain('"stalledCloses": 1');
}, 50000);
