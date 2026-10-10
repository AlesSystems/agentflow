import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { expect, it } from "vitest";

it("provides an executable external CLI producer with a safe help contract", async () => {
  expect(existsSync("scripts/p06-producer.ts"), "external CLI producer is missing").toBe(true);
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/p06-producer.ts", "--help"]);
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => stdout += chunk);
  child.stderr.on("data", chunk => stderr += chunk);
  const code = await new Promise(resolve => child.once("exit", resolve));
  expect(code, stderr).toBe(0);
  expect(stdout).toContain("AGENTFLOW_PRODUCER_DIR");
  expect(stdout).toContain("continue");
  expect(stderr).toBe("");
});
