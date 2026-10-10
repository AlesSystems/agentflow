import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { stop } from "./server";
import { cliFixture } from "./p06-cli";
import type { launch } from "./server";
export type Checkpoint = { stage: string; projectId?: string; taskId?: string; implementationId?: string; verificationId?: string; taskVersion?: number; taskStatus?: string; transcript: { operation: string; code: number; stdout: string; stderr: string; elapsedMs: number }[] };
export function journey(server: Awaited<ReturnType<typeof launch>>) {
  const fixture = cliFixture(server);
  const scratch = join(fixture.dir, "producer");
  mkdirSync(scratch, { mode: 0o700 });
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/p06-producer.ts"], { env: { ...process.env, ...fixture.env, AGENTFLOW_PRODUCER_DIR: scratch }, stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  const buffered: Checkpoint[] = [];
  let waiting: { resolve: (value: Checkpoint) => void; reject: (error: Error) => void } | undefined;
  let errors = "";
  let exited = false;
  child.stderr.on("data", chunk => errors += chunk);
  lines.on("line", line => {
    try {
      const value = JSON.parse(line) as Checkpoint;
      if (waiting) { const pending = waiting; waiting = undefined; pending.resolve(value); }
      else buffered.push(value);
    } catch { waiting?.reject(new Error("producer emitted invalid checkpoint")); }
  });
  const exit = new Promise<number | null>(resolve => child.once("exit", code => { exited = true; waiting?.reject(new Error(`producer exited ${code}: ${errors}`)); resolve(code); }));
  return {
    ...fixture, scratch, child, exit,
    errors: () => errors,
    next(): Promise<Checkpoint> {
      const value = buffered.shift();
      if (value) return Promise.resolve(value);
      if (exited) return Promise.reject(new Error("producer already exited"));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting = undefined; reject(new Error("producer checkpoint timeout")); }, 25000);
        waiting = { resolve(value) { clearTimeout(timer); resolve(value); }, reject(error) { clearTimeout(timer); reject(error); } };
      });
    },
    advance() { child.stdin.write("continue\n"); },
    async close() { lines.close(); await stop(child); },
  };
}
