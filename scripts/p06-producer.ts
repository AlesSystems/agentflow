#!/usr/bin/env -S node --import tsx
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import { cliConfig } from "../src/cli/config";
import { request } from "../src/cli/http";
import { uuid } from "../src/contracts/common";
import { taskDetailResponse } from "../src/contracts/responses";
import { acknowledgement } from "../src/contracts/observations";
import { activeAppRoot, inspectManaged, privateDestination } from "../src/server/filesystem";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("P06 synthetic external producer. Set PORT, AGENTFLOW_REPORTER_TOKEN_FILE, AGENTFLOW_OUTBOX_DIR and an existing private AGENTFLOW_PRODUCER_DIR.\nDefault runs online. --controlled emits checkpoints and waits for a line containing continue. The external harness stops the service at offline-request and restarts it at queued. AgentFlow never owns execution or human acceptance.");
} else {
  const transcript: { operation: string; code: number; stdout: string; stderr: string; elapsedMs: number }[] = [];
  const controlled = args.length === 1 && args[0] === "--controlled";
  const input = controlled ? createInterface({ input: process.stdin }) : undefined;
  const controls = input?.[Symbol.asyncIterator]();
  let fileIndex = 0;
  try {
    if (args.length && !controlled) throw new Error("invalid_arguments");
    const config = cliConfig();
    const scratch = privateDestination(process.env.AGENTFLOW_PRODUCER_DIR ?? "", activeAppRoot());
    const stat = lstatSync(scratch);
    inspectManaged(stat, true);
    if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700) throw new Error("private_producer_directory_required");
    function file(body: unknown) {
      const path = join(scratch, `input-${fileIndex++}.json`);
      writeFileSync(path, JSON.stringify(body), { mode: 0o600, flag: "wx" });
      return path;
    }
    async function cli(operation: string, command: string[], expected = 0) {
      const started = performance.now();
      const child = spawn(process.execPath, ["--import", "tsx", "src/cli/main.ts", ...command], { env: { ...process.env, FORCE_COLOR: undefined }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", chunk => stdout += chunk);
      child.stderr.on("data", chunk => stderr += chunk);
      const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
      const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); }).finally(() => clearTimeout(timer));
      if (code !== expected) throw new Error("unexpected_cli_exit");
      const rows = stdout.trim() ? stdout.trim().split("\n").map(line => JSON.parse(line)) : [];
      for (const row of rows) z.union([z.strictObject({ id: uuid, generation: uuid }), acknowledgement.extend({ generation: uuid })]).parse(row);
      const diagnostics = stderr.trim() ? stderr.trim().split("\n").map(line => JSON.parse(line)) : [];
      for (const diagnostic of diagnostics) z.strictObject({ code: z.literal("queued"), repair: z.string() }).parse(diagnostic);
      transcript.push({ operation, code, stdout, stderr, elapsedMs: performance.now() - started });
      return rows;
    }
    async function register(operation: string, command: string[], body: unknown) {
      return (await cli(operation, [...command, "--file", file(body), "--idempotency-key", randomUUID()]))[0].id as string;
    }
    async function report(operation: string, runId: string, type: string, payload: unknown, expected = 0) {
      await cli(operation, ["report", "--run", runId, "--type", type, "--payload", file(payload)], expected);
    }
    async function checkpoint(stage: string, facts: Record<string, unknown>) {
      console.log(JSON.stringify({ stage, ...facts, transcript }));
      if (controlled && stage !== "done") {
        const line = await controls!.next();
        if (line.done || line.value !== "continue") throw new Error("controller_continue_required");
      }
    }
    async function task(taskId: string) {
      const reply = await request(config, `/tasks/${taskId}`, taskDetailResponse, performance.now() + 5000);
      if (reply.kind !== "delivered") throw new Error("task_snapshot_required");
      return reply.data.data.task;
    }
    const projectId = await register("project", ["project", "create"], { name: "Synthetic P06 external harness" });
    const taskId = await register("task", ["task", "create"], { projectId, title: "Synthetic P06 CLI walkthrough", acceptanceCriteria: "Inspect independent reports before human acceptance." });
    const implementationAgent = await register("implementation agent", ["agent", "register"], { displayName: "Synthetic P06 implementer", source: "external CLI harness", defaultRole: "implementation" });
    const verificationAgent = await register("verification agent", ["agent", "register"], { displayName: "Synthetic P06 verifier", source: "external CLI harness", defaultRole: "verifier" });
    const implementationId = randomUUID(), verificationId = randomUUID();
    const facts = { projectId, taskId, implementationId, verificationId };
    await register("implementation run", ["run", "register"], { id: implementationId, projectId, taskId, agentId: implementationAgent, purpose: "implementation", expectedTaskVersion: (await task(taskId)).version });
    await checkpoint("registered", facts);
    await report("implementation start", implementationId, "run.started", {});
    await report("implementation heartbeat", implementationId, "run.heartbeat", {});
    await report("implementation progress", implementationId, "run.progress", { message: "Synthetic P06 implementation in progress", percent: 50 });
    await checkpoint("running", facts);
    if (controlled) {
      await checkpoint("offline-request", facts);
      await report("offline progress", implementationId, "run.progress", { message: "Synthetic P06 durable observation during downtime", percent: 75 }, 2);
      await checkpoint("queued", facts);
      await cli("fresh flush", ["flush", "--run", implementationId]);
      await checkpoint("recovered", facts);
    }
    await report("post-recovery heartbeat", implementationId, "run.heartbeat", {});
    await report("implementation success", implementationId, "run.succeeded", { summary: "Synthetic P06 implementation evidence awaits human acceptance" });
    const review = await task(taskId);
    if (review.status !== "review") throw new Error("review_snapshot_required");
    await checkpoint("implementation-review", { ...facts, taskStatus: review.status, taskVersion: review.version });
    const current = await task(taskId);
    await register("verification run", ["run", "register"], { id: verificationId, projectId, taskId, agentId: verificationAgent, purpose: "verification", expectedTaskVersion: current.version });
    await report("verification start", verificationId, "run.started", {});
    await report("verification heartbeat", verificationId, "run.heartbeat", {});
    await checkpoint("verification-running", { ...facts, taskVersion: current.version });
    await report("verification success", verificationId, "run.succeeded", { summary: "Synthetic P06 separate verification evidence" });
    const final = await task(taskId);
    if (final.status !== "review") throw new Error("human_acceptance_boundary");
    await checkpoint("done", { ...facts, taskStatus: final.status, taskVersion: final.version });
  } catch {
    process.stderr.write('{"code":"producer_failed","repair":"Preserve producer files and outbox; inspect the last checkpoint. Uncertain delivery uses flush."}\n');
    process.exitCode = 1;
  } finally { input?.close(); }
}
