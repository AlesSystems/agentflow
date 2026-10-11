import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { openOwnedStore } from "../../src/db";
import { restore } from "../../src/db/recovery";
import { canonicalDigest } from "../../src/domain/request-digest";
import type { CommandContext } from "../../src/db/application";
import { settings } from "../../src/contracts/settings";
import { uuid } from "../../src/contracts/common";
import { githubRefreshResponse, githubResponse, type GithubMetadata } from "../../src/contracts/github";
import { boundedLaunch, boundedPair, boundedFetch, readBoundedText } from "../fixtures/w01-runtime";
import { distribution } from "../fixtures/w01-capture";

type Prepared = { head: string; baseline: string; headDir: string; baseDir: string; repositories: string[]; rows: number };
type Sample = { id: string; operation: string; source: string; dataDir: string; round: number; warmup: boolean; index: number; path: string; dispatchMs: number; drainedMs: number | null; elapsedMs: number | null; status: number | null; text: string | null; generation: string | null; failure: string | null };
const root = resolve(process.env.AGENTFLOW_W03A_QUALIFICATION_DIR!);
assert(process.env.AGENTFLOW_W03A_QUALIFICATION_DIR, "owned qualification directory required");
const output = resolve(process.env.AGENTFLOW_W03A_CAPTURE_DIR!);
assert(process.env.AGENTFLOW_W03A_CAPTURE_DIR, "unique capture directory required");
const baseline = resolve(process.env.AGENTFLOW_W03A_BASE_SOURCE!);
assert(process.env.AGENTFLOW_W03A_BASE_SOURCE, "qualified W02 baseline required");
assert(!existsSync(output), "capture directory must be new");
mkdirSync(output, { mode: 0o700 });
const save = (name: string, value: unknown) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
const context = (input: unknown): CommandContext => ({ principal: "operator", method: "POST", path: "/api/v1/connections/github/refresh", key: randomUUID(), digest: canonicalDigest(input), now: Date.now() });
const expected = Array.from({ length: 10 }, (_, repository) => Array.from({ length: 100 }, (_, number) => [`synthetic/repo${repository}`, number + 1] as const)).flat();
let outbound = 0;
const wires: { method: string | undefined; url: string | undefined; receivedAt: number }[] = [];
const remote = createServer((req, res) => { outbound++; wires.push({ method: req.method, url: req.url, receivedAt: Date.now() }); res.statusCode = 500; res.end(); });
await new Promise<void>(resolve => remote.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(remote.address() as { port: number }).port}`;
const cleanup: unknown[] = [];
function facts(dataDir: string) {
 const db = new Database(join(dataDir, "agentflow.sqlite"), { readonly: true });
 try { return Object.fromEntries(["github_connection", "github_pull_requests", "github_lookup_attempts", "github_refresh_intents", "receipts", "changes"].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])); }
 finally { db.close(); }
}
async function service(source: string, dataDir: string, head: boolean, work: (server: Awaited<ReturnType<typeof boundedLaunch>>, cookie: string) => Promise<void>) {
 const before = head ? facts(dataDir) : null;
 const server = await boundedLaunch({ cwd: source, dir: dataDir, ...(head ? { entry: "tests/fixtures/w03a-server.ts", extraEnv: { W03A_FIXTURE_ORIGIN: origin, AGENTFLOW_GITHUB_TOKEN_FILE: join(root, "synthetic-credential.json") } } : {}) });
 try { await work(server, await boundedPair(server)); }
 finally { await server.stop(); cleanup.push({ source, dataDir, pid: server.child.pid, exitCode: server.child.exitCode, signalCode: server.child.signalCode, logs: server.logs() }); if (head) { const after = facts(dataDir); save(`read-facts-${cleanup.length}.json`, { before, after }); assert.deepEqual(after, before, "public reads must not alter cache, attempts, receipts, connection or changes"); cleanup.push({ dataDir, readFactsSHA256: createHash("sha256").update(JSON.stringify(after)).digest("hex"), readFactsUnchanged: true }); } }
}
async function read(server: Awaited<ReturnType<typeof boundedLaunch>>, cookie: string, path: string) {
 const response = await boundedFetch(server.url + path, { headers: { Cookie: cookie } });
 const text = await readBoundedText(response); assert.equal(response.status, 200, text);
 const body = JSON.parse(text); assert.equal(response.headers.get("AgentFlow-Generation"), body.generation); if (body.data.connection) assert.equal(body.data.connection.credential, "configured"); else validateSettings(body, server.dir);
 return body;
}
function validateSettings(body: { data: unknown; generation: unknown }, dataDir: string) {
 uuid.parse(body.generation); const parsed = settings.parse(body.data);
 assert.equal(parsed.timezone, "UTC"); assert.equal(parsed.version, 1); assert.equal(parsed.dataLocation, dataDir); assert.equal(parsed.storageMeasurement, "observational");
}
function validateCache(body: unknown, wanted: readonly (readonly [string, number])[], total: number) {
 const parsed = githubResponse.parse(body);
 assert.equal(parsed.data.total, total);
 assert.deepEqual(parsed.data.connection.repositories, expected.filter((_, index) => index % 100 === 0).map(row => row[0]));
 assert.equal(parsed.data.connection.enabled, true);
 assert.deepEqual(parsed.data.items.map(item => [item.repository, item.number]), wanted);
 for (const item of parsed.data.items) { assert.equal(item.title, "Synthetic PR"); assert.equal(item.url, `https://github.com/${item.repository}/pull/${item.number}`); assert.equal(item.headSha, "a".repeat(40)); }
 return parsed;
}
try {
 const mode = process.argv[2];
 if (mode === "prepare") {
  assert(!existsSync(join(root, "prepared.json")), "prepared fixture must be new");
  writeFileSync(join(root, "synthetic-credential.json"), JSON.stringify({ token: "SYNTHETIC_QUALIFICATION_TOKEN" }), { mode: 0o600, flag: "wx" });
  const prepared: Prepared = { head: process.cwd(), baseline, headDir: join(root, "head-data"), baseDir: join(root, "base-data"), repositories: expected.filter((_, index) => index % 100 === 0).map(row => row[0]), rows: 1000 };
  assert(!existsSync(prepared.headDir) && !existsSync(prepared.baseDir), "data directories must be new");
  const owned = await openOwnedStore(prepared.headDir);
  try {
   const input = { expectedVersion: 1, enabled: true, repositories: prepared.repositories };
   owned.store.githubRepositories(input, { ...context(input), method: "PUT", path: "/api/v1/connections/github/repositories" });
   for (const repository of prepared.repositories) for (let page = 1; page <= 5; page++) {
    const request = { expectedVersion: 2, repository, page };
    const admitted = owned.store.githubAdmit(request, context(request), false); assert.equal(admitted.kind, "admitted");
    if (admitted.kind !== "admitted") throw Error("expected fresh admitted intent");
    const items: GithubMetadata[] = Array.from({ length: 20 }, (_, i) => { const number = (page - 1) * 20 + i + 1; return { repository, number, url: `https://github.com/${repository}/pull/${number}`, title: "Synthetic PR", state: "open", draft: false, headSha: "a".repeat(40), baseBranch: "main", mergedAt: null }; });
    const result = owned.store.githubFinalize(admitted.intent, { outcome: "fetched", error: null, retryNotBefore: null, nextPage: page < 5 ? page + 1 : null, items }, Date.now());
    assert.equal(githubRefreshResponse.parse(result.body).data.count, 20);
   }
   validateCache(owned.store.githubSnapshot({ limit: 100 }).body, expected.slice(0, 100), 1000);
   assert.deepEqual(owned.store.snapshot({ kind: "tasks", input: { limit: 20 } }).body.data, { items: [], total: 0, nextCursor: null });
  } finally { owned.close(); }
  await service(prepared.baseline, prepared.baseDir, false, async (server, cookie) => { const body = await read(server, cookie, "/api/v1/settings"); assert.equal(body.data.version, 1); save("base-settings.json", body); });
  await service(prepared.head, prepared.headDir, true, async (server, cookie) => {
   let cursor: string | null = null; const observed: (readonly [string, number])[] = [];
   for (let page = 0; page < 10; page++) { const path = "/api/v1/connections/github?limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""); const body = validateCache(await read(server, cookie, path), expected.slice(page * 100, page * 100 + 100), 1000); observed.push(...body.data.items.map(item => [item.repository, item.number] as const)); cursor = body.data.nextCursor; save(`cache-page-${page}.json`, { path, body }); }
   assert.equal(cursor, null); assert.deepEqual(observed, expected); assert.equal(new Set(observed.map(row => row.join("#"))).size, 1000);
   validateCache(await read(server, cookie, "/api/v1/connections/github?limit=100&repository=synthetic%2Frepo9"), expected.slice(900), 100);
   validateCache(await read(server, cookie, "/api/v1/connections/github?limit=100&repository=synthetic%2Frepo9&number=100"), [expected[999]], 1);
   const status = async (headers: Record<string, string>, query = "") => { const response = await boundedFetch(server.url + "/api/v1/connections/github" + query, { headers }); await readBoundedText(response); return response.status; };
   assert.equal(await status({}), 401); assert.equal(await status({ Authorization: "Bearer " + server.credentials().reporterToken }), 403); assert.equal(await status({ Cookie: cookie }, "?limit=101"), 400);
   save("head-settings.json", await read(server, cookie, "/api/v1/settings"));
  });
  const stopped = await openOwnedStore(prepared.headDir);
  const generation = stopped.store.metadata().generation;
  const backup = join(prepared.headDir, "backups", "qualified-cache.sqlite");
  try { await stopped.store.backup(backup); assert.equal(stopped.store.integrity().integrity, "ok"); }
  finally { stopped.close(); }
  const restored = await restore(prepared.headDir, backup);
  assert.notEqual(restored.generation, generation);
  await service(prepared.head, prepared.headDir, true, async (server, cookie) => { const body = validateCache(await read(server, cookie, "/api/v1/connections/github?limit=100"), expected.slice(0, 100), 1000); assert.equal(body.generation, restored.generation); save("restored-cache.json", { generationBefore: generation, restored, body }); });
  assert.equal(outbound, 0);
  writeFileSync(join(root, "prepared.json"), JSON.stringify(prepared, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  save("prepared-result.json", { prepared, outbound, fullCacheIdentityCount: 1000, cacheIngress: "Synthetic Store-admitted/finalized fixture preparation, no live or remote GitHub fetch", cleanup });
 } else if (mode === "measure") {
  const release = JSON.parse(readFileSync(process.env.AGENTFLOW_W03A_QUIET_RELEASE!, "utf8"));
  assert.equal(release.helperSHA256, createHash("sha256").update(readFileSync(import.meta.filename)).digest("hex"));
  assert.equal(release.source, process.cwd());
  const prepared: Prepared = JSON.parse(readFileSync(join(root, "prepared.json"), "utf8"));
  assert.equal(prepared.head, process.cwd()); assert.equal(prepared.baseline, baseline);
  const samples: Sample[] = [];
  const declarations = Array.from({ length: 3 }, (_, i) => { const round = i + 1; return ["base", "head"].flatMap(variant => Array.from({ length: 110 }, (_, index) => ({ id: `settings-${variant}-${round}-${index}`, warmup: index < 10 }))).concat(Array.from({ length: 110 }, (_, index) => ({ id: `cache-head-${round}-${index}`, warmup: index < 10 }))); }).flat();
  save("declared-samples.json", declarations);
  async function group(variant: "base" | "head", round: number, operation: "settings" | "cache") {
   const source = variant === "base" ? prepared.baseline : prepared.head, dataDir = variant === "base" ? prepared.baseDir : prepared.headDir;
   await service(source, dataDir, variant === "head", async (server, cookie) => {
    for (let index = 0; index < 110; index++) {
     const sample: Sample = { id: `${operation}-${variant}-${round}-${index}`, operation, source, dataDir, round, warmup: index < 10, index, path: operation === "settings" ? "/api/v1/settings" : "/api/v1/connections/github?limit=100", dispatchMs: performance.now(), drainedMs: null, elapsedMs: null, status: null, text: null, generation: null, failure: null };
     try { const response = await boundedFetch(server.url + sample.path, { headers: { Cookie: cookie } }); sample.status = response.status; sample.generation = response.headers.get("AgentFlow-Generation"); sample.text = await readBoundedText(response, text => { sample.text = text; }); sample.drainedMs = performance.now(); sample.elapsedMs = sample.drainedMs - sample.dispatchMs; assert.equal(sample.status, 200, sample.text); const body = JSON.parse(sample.text); assert.equal(sample.generation, body.generation); if (operation === "cache") { validateCache(body, expected.slice(0, 100), 1000); assert.equal(body.data.connection.credential, "configured"); } else validateSettings(body, dataDir); }
     catch (error) { sample.failure = String(error); throw error; }
     finally { sample.drainedMs ??= performance.now(); sample.elapsedMs ??= sample.drainedMs - sample.dispatchMs; samples.push(sample); save(sample.id + ".json", sample); }
    }
   });
  }
  for (let round = 1; round <= 3; round++) for (const variant of round === 2 ? ["head", "base"] as const : ["base", "head"] as const) await group(variant, round, "settings");
  for (let round = 1; round <= 3; round++) await group("head", round, "cache");
  assert.equal(samples.length, declarations.length); assert.equal(new Set(samples.map(sample => sample.id)).size, 990); assert.deepEqual([...samples].map(sample => ({ id: sample.id, warmup: sample.warmup })).sort((a, b) => a.id.localeCompare(b.id)), [...declarations].sort((a, b) => a.id.localeCompare(b.id))); assert.equal(outbound, 0);
  const summaries = Array.from({ length: 3 }, (_, i) => { const round = i + 1; const summarize = (source: string, operation: string) => { const rows = samples.filter(sample => sample.source === source && sample.operation === operation && sample.round === round); assert.equal(rows.length, 110); assert.equal(rows.filter(row => row.warmup).length, 10); assert(rows.every(row => row.status === 200 && row.failure === null && row.elapsedMs !== null && Number.isFinite(row.elapsedMs))); return distribution(rows.filter(row => !row.warmup).map(row => row.elapsedMs!)); }; const base = summarize(prepared.baseline, "settings"), head = summarize(prepared.head, "settings"), cache = summarize(prepared.head, "cache"); return { round, base, head, cache, settingsRegressionPercent: (head.p95Ms / base.p95Ms - 1) * 100, approvalRequired: head.p95Ms > base.p95Ms * 1.2 }; });
  save("summary.json", { prepared, outbound, summaries, cleanup });
  assert(summaries.every(group => group.cache.p95Ms < 250), "cached snapshot p95 budget exceeded");
  assert(summaries.every(group => !group.approvalRequired), "existing settings p95 regression requires explanation and Astra approval");
 } else throw Error("prepare or measure required");
} finally {
 await new Promise<void>(resolve => { remote.close(() => resolve()); remote.closeAllConnections(); });
 save("cleanup.json", { outbound, wires, fixtureOrigin: origin, services: cleanup, remoteListening: remote.listening });
}
