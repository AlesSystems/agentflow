import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, pair } from "./server";
import { usageResponse } from "../../src/contracts/usage";

const bounds = { startupMs: 30000, healthMs: 2000, terminateMs: 10000, killMs: 5000 };
export async function usageCliFixture(name: string, delivery?: (server: Awaited<ReturnType<typeof launch>>) => Promise<number>) {
  const root = mkdtempSync(join(process.env.AGENTFLOW_W03C_CLI_DATA_DIR ?? tmpdir(), "usage-cli-"));
  chmodSync(root, 0o700);
  const data = join(root, "data"), outbox = join(root, "outbox"), proof = join(root, "copies");
  for (const path of [data, proof]) mkdirSync(path, { mode: 0o700 });
  const identities = Object.fromEntries([root, data, proof].map(path => { const s = lstatSync(path); return [path, { uid: s.uid, device: s.dev, inode: s.ino, mode: s.mode & 0o777 }]; }));
  const commands: unknown[] = [], services: unknown[] = [], requests: unknown[] = [], copies: unknown[] = [];
  let server: Awaited<ReturnType<typeof launch>>, closed: Promise<void>, serviceCapture: { argv: string[]; pid: number | undefined; stdout: Buffer[]; stderr: Buffer[] };
  let stopped = true, cookie = "", port: number | undefined, index = 0;
  async function start() {
    server = await launch({ dir: data, port, bounds, onChild(child) {
      serviceCapture = { argv: child.spawnargs, pid: child.pid, stdout: [], stderr: [] };
      child.stdout!.on("data", part => serviceCapture.stdout.push(Buffer.from(part)));
      child.stderr!.on("data", part => serviceCapture.stderr.push(Buffer.from(part)));
      closed = new Promise(resolve => child.once("close", () => resolve()));
    } });
    port = server.port; stopped = false; cookie = await pair(server);
  }
  async function stop() {
    if (stopped) return;
    await server.stop(); await closed; stopped = true;
    services.push({ ...serviceCapture, stdout: undefined, stderr: undefined, stdoutBase64: Buffer.concat(serviceCapture.stdout).toString("base64"), stderrBase64: Buffer.concat(serviceCapture.stderr).toString("base64"), cwd: process.cwd(), node: process.execPath, exit: server.child.exitCode, signal: server.child.signalCode, stdioClosed: server.child.stdio.every(s => !s || typeof s === "number" || s.destroyed) });
  }
  function file(value: unknown) { const path = join(root, `input-${index++}.json`); writeFileSync(path, JSON.stringify(value), { mode: 0o600 }); return path; }
  await start(); const deliveryPort = delivery ? await delivery(server!) : port!;
  const token = join(root, "token"); writeFileSync(token, server!.credentials().reporterToken, { mode: 0o600 });
  async function command(args: string[], local = false, selectedPort = deliveryPort) {
    const argv = ["--import", "tsx", local ? "src/cli/local.ts" : "src/cli/main.ts", ...args];
    const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(selectedPort), AGENTFLOW_REPORTER_TOKEN_FILE: token, AGENTFLOW_OUTBOX_DIR: outbox, ...(local ? { AGENTFLOW_DATA_DIR: data } : {}) };
    const child = spawn(process.execPath, argv, { env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    child.stdout.on("data", part => stdout.push(Buffer.from(part))); child.stderr.on("data", part => stderr.push(Buffer.from(part)));
    const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
    const result = { code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
    commands.push({ ...result, argv: [process.execPath, ...argv], cwd: process.cwd(), env: { PORT: env.PORT, AGENTFLOW_REPORTER_TOKEN_FILE: token, AGENTFLOW_OUTBOX_DIR: outbox, AGENTFLOW_DATA_DIR: local ? data : null, PATH: env.PATH, TMPDIR: env.TMPDIR, npm_config_cache: env.npm_config_cache }, pid: child.pid, signal: child.signalCode, stdioClosed: child.stdio.every(s => !s || typeof s === "number" || s.destroyed) });
    return result;
  }
  async function register(args: string[], body: unknown) {
    const result = await command([...args, "--file", file(body), "--idempotency-key", randomUUID()]);
    if (result.code !== 0) throw new Error("usage CLI registration failed " + result.stderr);
    return JSON.parse(result.stdout).id as string;
  }
  async function request(path: string, input?: unknown, human = false, method = input === undefined ? "GET" : "POST") {
    const response = await fetch(server.url + "/api/v1" + path, { method, headers: { ...(human ? { Cookie: cookie, Origin: server.url } : { Authorization: "Bearer " + server.credentials().reporterToken }), "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(10000) });
    const body = await response.text(); requests.push({ path, method, input, status: response.status, generation: response.headers.get("AgentFlow-Generation"), body });
    return { status: response.status, generation: response.headers.get("AgentFlow-Generation"), text: body, body: body ? JSON.parse(body) : null };
  }
  const projectId = await register(["project", "create"], { name: "Synthetic usage CLI" });
  const taskId = await register(["task", "create"], { projectId, title: "Synthetic reported work" });
  const agentId = await register(["agent", "register"], { displayName: "Synthetic CLI", source: "fixture", defaultRole: "implementation" });
  async function run(purpose: "implementation" | "review" = "implementation") {
    const task = (await request("/tasks/" + taskId)).body.data.task;
    return register(["run", "register"], { id: randomUUID(), projectId, taskId, agentId, purpose, expectedTaskVersion: task.version });
  }
  const runId = await run();
  function pending(id = runId) { const directory = join(outbox, id); return readdirSync(directory).filter(n => /^\d+-/.test(n)).sort().map(name => ({ name, bytes: readFileSync(join(directory, name)), path: join(directory, name) })); }
  function state(id = runId) { return readFileSync(join(outbox, id, "state.json")); }
  async function summary() { const from = new Date(Date.now() - 86400000).toISOString(), to = new Date(Date.now() + 86400000).toISOString(); return usageResponse.parse((await request(`/usage?projectId=${projectId}&from=${from}&to=${to}`)).body); }
  function copiedSql(label: string) {
    if (!stopped) throw new Error("copy requires stopped service");
    const destination = join(proof, label); mkdirSync(destination, { mode: 0o700 });
    const original = () => Object.fromEntries(["", "-wal", "-shm"].filter(s => existsSync(join(data, "agentflow.sqlite" + s))).map(s => [s, createHash("sha256").update(readFileSync(join(data, "agentflow.sqlite" + s))).digest("hex")]));
    const before = original(); for (const suffix of Object.keys(before)) { copyFileSync(join(data, "agentflow.sqlite" + suffix), join(destination, "agentflow.sqlite" + suffix)); chmodSync(join(destination, "agentflow.sqlite" + suffix), 0o600); }
    const db = new Database(join(destination, "agentflow.sqlite"), { readonly: true });
    let facts;
    try { facts = { integrity: db.pragma("integrity_check"), foreignKeys: db.pragma("foreign_key_check"), usage: db.prepare("SELECT * FROM usage_measurements ORDER BY run_id,usage_id").all(), events: db.prepare<[],{ event_id: string; run_id: string; sequence: number; type: string; digest: string; acknowledgement: string }>("SELECT event_id,run_id,sequence,type,digest,acknowledgement FROM run_events ORDER BY run_id,sequence").all(), runs: db.prepare("SELECT id,purpose,state,last_sequence,work_revision,rework_round FROM runs ORDER BY registration_order").all(), tasks: db.prepare("SELECT id,status,work_revision,rework_round FROM tasks").all() }; }
    finally { db.close(); }
    if (JSON.stringify(facts.integrity) !== JSON.stringify([{ integrity_check: "ok" }]) || !Array.isArray(facts.foreignKeys) || facts.foreignKeys.length) throw new Error("copied database integrity failed");
    const after = original(); if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("original triplet changed during copied SQL inspection");
    copies.push({ label, before, after, destination, facts }); return facts;
  }
  async function finish(extra: unknown = null) {
    await stop(); const facts = copiedSql("final");
    const output = { name, root, identities, projectId, taskId, agentId, runId, commands, services, requests, copies, extra, facts };
    if (process.env.AGENTFLOW_W03C_CLI_PROOF_DIR) writeFileSync(join(process.env.AGENTFLOW_W03C_CLI_PROOF_DIR, `${name}-${randomUUID()}.json`), JSON.stringify(output, null, 2), { mode: 0o600 });
    return facts;
  }
  return { get port() { return deliveryPort; }, get server() { return server; }, root, data, outbox, projectId, taskId, agentId, runId, start, stop, file, command, register, request, run, pending, state, summary, copiedSql, finish };
}
export const reportedUsage = (usageId: string, inputTokens: number | null = 3, outputTokens: number | null = 7) => ({ usageId, source: "fixture", model: "model", measuredAt: "2026-01-01T00:00:00.000Z", inputTokens, outputTokens, billingBasis: "input_output_only" as const });
