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

it("observes implementation Review and a fresh verification attempt across downtime through real CLI subprocesses", async () => {
  const { launch } = await import("../fixtures/server");
  const { journey } = await import("../fixtures/p06-producer");
  const { default: Database } = await import("better-sqlite3");
  const { join } = await import("node:path");
  const { readdirSync, readFileSync, writeFileSync } = await import("node:fs");
  let server = await launch();
  const producer = journey(server);
  const checkpoints: unknown[] = [];
  async function next(stage: string) {
    const value = await producer.next();
    expect(value.stage).toBe(stage);
    checkpoints.push(value);
    return value;
  }
  const auth = () => ({ Authorization: "Bearer " + server.credentials().reporterToken });
  try {
    const registered = await next("registered");
    producer.advance();
    await next("running");
    const running = await (await fetch(server.url + `/api/v1/runs/${registered.implementationId}`, { headers: auth() })).json();
    expect(running.data).toMatchObject({ state: "running", lastSequence: 3 });
    producer.advance();
    await next("offline-request");
    const { dir, port } = server;
    await server.stop();
    producer.advance();
    const queued = await next("queued");
    expect(queued.transcript.at(-1)).toMatchObject({ operation: "offline progress", code: 2 });
    const runDir = join(producer.env.AGENTFLOW_OUTBOX_DIR, registered.implementationId!);
    const entry = readdirSync(runDir).find(name => /^4-.*\.json$/.test(name));
    expect(entry).toBeDefined();
    const immutable = JSON.parse(readFileSync(join(runDir, entry!), "utf8"));
    server = await launch({ dir, port });
    producer.advance();
    await next("recovered");
    producer.advance();
    const review = await next("implementation-review");
    expect(review).toMatchObject({ taskStatus: "review", taskVersion: 4 });
    producer.advance();
    const verification = await next("verification-running");
    expect(verification.taskVersion).toBe(4);
    producer.advance();
    const done = await next("done");
    expect(await producer.exit, producer.errors()).toBe(0);
    expect(done).toMatchObject({ taskStatus: "review", taskVersion: 5 });
    const task = await (await fetch(server.url + `/api/v1/tasks/${registered.taskId}`, { headers: auth() })).json();
    expect(task.data.task).toMatchObject({ status: "review", workRevision: 2, version: 5 });
    const events = await (await fetch(server.url + `/api/v1/runs/${registered.implementationId}/events`, { headers: auth() })).json();
    expect(events.data.items.map((event: { type: string }) => event.type)).toEqual(["run.started", "run.heartbeat", "run.progress", "run.progress", "run.heartbeat", "run.succeeded"]);
    const db = new Database(join(server.dir, "agentflow.sqlite"), { readonly: true });
    try {
      expect(db.prepare("SELECT COUNT(*) n FROM run_events").get()).toEqual({ n: 9 });
      expect(db.prepare("SELECT COUNT(*) n FROM completions").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT purpose,state,last_sequence FROM runs ORDER BY registration_order").all()).toEqual([{ purpose: "implementation", state: "succeeded", last_sequence: 6 }, { purpose: "verification", state: "succeeded", last_sequence: 3 }]);
      expect(db.prepare("SELECT event_id,sequence,digest FROM run_events WHERE run_id=? AND sequence=4").get(registered.implementationId)).toMatchObject({ event_id: immutable.body.eventId, sequence: immutable.body.sequence, digest: immutable.digest });
      const expectedCodes = done.transcript.map(command => command.code);
      expect(expectedCodes).toEqual([0,0,0,0,0,0,0,0,2,0,0,0,0,0,0,0]);
      for (const command of done.transcript) {
        expect(command.stdout + command.stderr).not.toContain(server.credentials().reporterToken);
        expect(command.stdout + command.stderr).not.toContain(producer.dir);
        expect(command.stdout + command.stderr).not.toContain("Synthetic P06");
      }
      if (process.env.AGENTFLOW_P06_EVIDENCE_DIR) writeFileSync(join(process.env.AGENTFLOW_P06_EVIDENCE_DIR, "producer.json"), JSON.stringify({ checkpoints, immutable, task: task.data.task, events: events.data.items, owned: [server.dir, producer.dir] }, null, 2) + "\n", { mode: 0o600 });
    } finally { db.close(); }
  } finally { await producer.close(); await server.stop(); }
}, 45000);


it("runs the standalone online producer without a controller or a downtime claim", async () => {
  const { launch } = await import("../fixtures/server");
  const { journey } = await import("../fixtures/p06-producer");
  const server = await launch();
  const producer = journey(server, false);
  try {
    const checkpoints = [];
    for (const stage of ["registered", "running", "implementation-review", "verification-running", "done"]) {
      const value = await producer.next(); expect(value.stage).toBe(stage); checkpoints.push(value);
    }
    expect(await producer.exit, producer.errors()).toBe(0);
    const done = checkpoints.at(-1)!;
    expect(done).toMatchObject({ taskStatus: "review", taskVersion: 5 });
    expect(done.transcript).toHaveLength(14);
    expect(done.transcript.every(record => record.code === 0)).toBe(true);
    expect(done.transcript.some(record => record.operation.includes("offline"))).toBe(false);
  } finally { await producer.close(); await server.stop(); }
});
