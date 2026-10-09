import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import Database from "better-sqlite3";
import { startRuntime } from "../../src/server/launcher";
import { readConfig } from "../../src/server/config";
import { hashSecret } from "../../src/server/auth";
import { freePort } from "./server";
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
async function until(check: () => boolean, timeout = 8000) {
  const start = performance.now();
  while (!check()) { assert(performance.now() - start < timeout, "condition timeout"); await sleep(25); }
}
const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-p05-production-"));
const port = await freePort();
let beforeClose: unknown;
const running = await startRuntime(readConfig({ ...process.env, AGENTFLOW_DATA_DIR: dir, PORT: String(port) }, "production"), { beforeStoreClose: async () => {
  beforeClose = { ...running.streams.diagnostics(), ...running.diagnostics() };
  assert.equal(running.diagnostics().requests, 0);
  assert.equal(running.diagnostics().activeSockets, 0);
  assert.equal(running.streams.diagnostics().leases, 0);
  assert.equal(running.streams.diagnostics().timers, 0);
  assert.equal(running.streams.diagnostics().listeners, 0);
} });
const url = `http://127.0.0.1:${port}`;
const unregister = running.owned.instance.registerConnection();
const db = new Database(join(dir, "agentflow.sqlite"));
const sockets: Socket[] = [];
const controllers: AbortController[] = [];
const secret = randomBytes(32).toString("hex");
const hash = hashSecret(secret);
const cookie = `agentflow_session=${secret}`;
const generation = running.owned.store.metadata().generation;
const path = `/api/v1/changes/stream?after=0&generation=${generation}`;
const headers = { Cookie: cookie, "Accept-Encoding": "gzip" };
const proof: Record<string, unknown> = {
  build: process.env.NODE_ENV, buildId: readFileSync(".next/BUILD_ID", "utf8"),
  sourceFiles: Object.fromEntries(["src/server/launcher.ts", "src/server/change-stream.ts", "src/db/index.ts", "src/contracts/stream.ts"].map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])),
};
async function memory() {
  for (let i = 0; i < 3; i++) { global.gc?.(); await sleep(25); }
  return { ...process.memoryUsage(), ...running.streams.diagnostics() };
}
function session(expiry = Date.now() + 60000) { running.owned.store.revoke(hash); running.owned.store.createSession(hash, Date.now(), expiry); }
function seed(count: number) {
  const insert = db.prepare("INSERT INTO changes(entity_type,entity_id,kind,received_at) VALUES('task',?,'updated',0)");
  db.transaction(() => { for (let i = 0; i < count; i++) insert.run("x".repeat(100)); })();
}
async function stream(after = "0") {
  const controller = new AbortController(); controllers.push(controller);
  const response = await fetch(url + path.replace("after=0", `after=${after}`), { headers, signal: controller.signal });
  return { response, controller };
}
async function paused() {
  const socket = connect(port, "127.0.0.1"); sockets.push(socket);
  await new Promise<void>(resolve => socket.once("connect", resolve));
  socket.pause();
  socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nCookie: ${cookie}\r\nAccept-Encoding: gzip\r\n\r\n`);
  await until(() => running.streams.diagnostics().blocked > 0);
  return socket;
}
try {
  session();
  seed(20000);
  await fetch(url + path, { method: "HEAD", headers });
  await (await fetch(url + "/api/v1/projects?limit=1", { headers })).arrayBuffer();
  proof.idle = await memory();
  // Snapshot -> write -> subscribe uses the captured cursor and real committed row.
  const snapshot = await fetch(url + "/api/v1/projects?limit=1", { headers });
  assert.equal(snapshot.status, 200);
  const baseline = (await snapshot.json()).snapshotCursor as string;
  const publicWrite = async () => {
    const result = await fetch(url + "/api/v1/projects", {
      method: "POST", headers: { Cookie: cookie, Origin: url, "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ name: "Synthetic stream gap" }),
    });
    assert.equal(result.status, 201);
    await result.arrayBuffer();
  };
  await publicWrite();
  const first = await stream(baseline);
  assert.equal(first.response.status, 200);
  assert.equal(first.response.headers.get("content-encoding"), null);
  assert.equal(first.response.headers.get("content-type"), "text/event-stream");
  const reader = first.response.body!.getReader();
  const at = performance.now();
  const chunk = await reader.read();
  assert.match(new TextDecoder().decode(chunk.value), new RegExp(`id: ${BigInt(baseline) + 1n}\\nevent: change`));
  proof.incrementalMs = performance.now() - at;
  const notice = JSON.parse(new TextDecoder().decode(chunk.value).split("data: ")[1].trim());
  assert.deepEqual(Object.keys(notice).sort(), ["entityId", "entityType", "kind"]);
  let received = false;
  const second = reader.read().then(c => { received = true; return c; });
  await sleep(100); assert.equal(received, false);
  await publicWrite();
  assert.match(new TextDecoder().decode((await second).value), new RegExp(`id: ${BigInt(baseline) + 2n}\\nevent: change`));
  first.controller.abort(); await until(() => running.streams.diagnostics().leases === 0);
  for (const query of ["after=00", "after=9223372036854775808", "after=1&after=2", "after=1&unknown=x", "after=1&__proto__=x"] ) {
    const response = await fetch(`${url}/api/v1/changes/stream?${query}&generation=${generation}`, { headers });
    assert.equal(response.status, 400); assert.notEqual(response.headers.get("content-type"), "text/event-stream");
  }
  const rejectedHeaders: Record<string, string>[] = [
    { Origin: "http://evil.example" }, { "Sec-Fetch-Site": "cross-site" }, { "Last-Event-ID": "00" },
  ];
  for (const rejected of rejectedHeaders) { const result = await fetch(url + path, { headers: { ...headers, ...rejected } }); assert([400,403].includes(result.status), JSON.stringify({ rejected, status: result.status })); }
  async function rawRejected(raw: string, status: number) {
    const socket = connect(port, "127.0.0.1"); sockets.push(socket);
    let reply = "";
    socket.on("data", chunk => reply += chunk.toString());
    socket.write(`GET ${path} HTTP/1.1\r\n${raw}\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`);
    await until(() => reply.includes("\r\n"));
    assert.match(reply, new RegExp(`^HTTP/1.1 ${status} `));
    socket.destroy();
  }
  await rawRejected("Host: evil.example", 403);
  await rawRejected(`Host: 127.0.0.1:${port}\r\nOrigin: ${url}\r\nOrigin: http://evil.example`, 403);
  await rawRejected(`Host: 127.0.0.1:${port}\r\nLast-Event-ID: 1\r\nLast-Event-ID: 2`, 400);
  await rawRejected(`Host: 127.0.0.1:${port}\r\nContent-Length: 65537`, 413);
  await rawRejected(`Host: 127.0.0.1:${port}\r\nContent-Length: 1`, 400);
  for (const token of [running.owned.credentials.reporterToken, running.owned.credentials.pairingToken])
    assert([401,403].includes((await fetch(url + path, { headers: { Authorization: `Bearer ${token}` } })).status));
  assert.equal((await fetch(url + path, { method: "HEAD", headers })).status, 200);
  const mismatch = await fetch(url + path.replace(generation, "10000000-0000-4000-8000-000000000002"), { headers });
  assert.equal(mismatch.headers.get("agentflow-generation"), generation);
  assert.match(await mismatch.text(), /generation_changed/);
  const ahead = await stream("9223372036854775807");
  assert.match(await ahead.response.text(), /event: reset/);
  const precedence = new AbortController(); controllers.push(precedence);
  const chosen = await fetch(url + path.replace("after=0", "after=0"), { headers: { ...headers, "Last-Event-ID": "1" }, signal: precedence.signal });
  assert.match(new TextDecoder().decode((await chosen.body!.getReader().read()).value), /id: 2\nevent: change/);
  precedence.abort(); await until(() => running.streams.diagnostics().leases === 0);
  // Real native socket pressure; maximum buffer is measured before reader resumption.
  const stalled = await paused();
  const pressure = running.streams.diagnostics();
  proof.pausedMemory = await memory();
  assert(pressure.peakBytes < 1048576);
  const writerAt = performance.now();
  db.prepare("UPDATE settings SET timezone='UTC'").run();
  proof.pausedWriterMs = performance.now() - writerAt;
  await until(() => running.streams.diagnostics().leases === 0, 8000);
  proof.stall = { pressure, closed: running.streams.diagnostics(), elapsedMs: performance.now() - pressure.pressureAt };
  assert(running.streams.diagnostics().stalledCloses > 0);
  stalled.destroy();
  const replay = await stream("2");
  const replayChunk = await replay.response.body!.getReader().read();
  assert.match(new TextDecoder().decode(replayChunk.value), /id: 3\nevent: change/);
  replay.controller.abort(); await until(() => running.streams.diagnostics().leases === 0);
  for (const mode of ["revoke", "expire"] as const) {
    session(mode === "expire" ? Date.now() + 1800 : Date.now() + 60000);
    const socket = await paused();
    if (mode === "revoke") running.owned.store.revoke(hash);
    await until(() => running.streams.diagnostics().leases === 0);
    const invalid = running.streams.diagnostics();
    assert(invalid.invalidAt >= invalid.lastWriteAt);
    const writes = invalid.writes;
    socket.resume(); await sleep(100);
    assert.equal(running.streams.diagnostics().writes, writes);
    proof[mode] = invalid;
    socket.destroy();
  }
  session();
  const maximum = running.owned.store.changeBatch("0").maximum;
  const opened = [];
  for (let i = 0; i < 20; i++) opened.push(await stream(maximum));
  proof.steadyMemory = await memory();
  const excess = await stream(maximum);
  assert.equal(excess.response.status, 429); assert.equal(excess.response.headers.get("retry-after"), "1");
  for (const entry of opened) entry.controller.abort();
  await until(() => running.streams.diagnostics().leases === 0);
  for (let i = 0; i < 100; i++) { const entry = await stream(maximum); entry.controller.abort(); await until(() => running.streams.diagnostics().leases === 0); }
  proof.postCloseMemory = await memory();
  assert((proof.postCloseMemory as { heapUsed: number }).heapUsed <= (proof.idle as { heapUsed: number }).heapUsed * 1.2, "heap exceeds 20% idle bound");
  const closing = await paused();
  db.close(); unregister();
  await running.shutdown();
  proof.shutdown = beforeClose;
  closing.destroy();
  console.log(JSON.stringify(proof, null, 2));
} catch (error) {
  process.exitCode = 1;
  throw error;
} finally {
  for (const controller of controllers) controller.abort();
  for (const socket of sockets) socket.destroy();
  if (db.open) { db.close(); unregister(); }
  await running.shutdown();
  rmSync(dir, { recursive: true });
}
