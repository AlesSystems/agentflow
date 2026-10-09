import { startRuntime } from "../../src/server/launcher";
import { readConfig } from "../../src/server/config";
import { createInterface } from "node:readline";
let controlled = Date.parse("2026-10-10T23:59:30.000Z");
Date.now = () => controlled;
const runtime = await startRuntime(readConfig(process.env, "production"));
createInterface({ input: process.stdin }).on("line", line => {
  const next = Date.parse(line);
  if (!Number.isFinite(next)) throw new Error("CLOCK_INPUT_INVALID");
  controlled = next;
  process.stdout.write(`CLOCK_CHANGED ${new Date(controlled).toISOString()}\n`);
});
process.once("SIGTERM", () => void runtime.shutdown().then(() => process.exit(0)));
