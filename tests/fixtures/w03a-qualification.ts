import assert from "node:assert/strict";
import { githubResponse } from "../../src/contracts/github";
import { stop } from "./server";
import { boundedLaunch, boundedPair, deadline, ownedBounds } from "./w01-runtime";
export const cacheIdentities = Array.from({ length: 10 }, (_, repository) => Array.from({ length: 100 }, (_, number) => [`synthetic/repo${repository}`, number + 1] as const)).flat();
export type CacheProvenance = { generation: string; snapshotCursor: string; connection?: { last_attempted_at: number | null; last_fetched_at: number | null }; rows: { repository: string; number: number; fetched_at: number; last_attempted_at: number }[] };
export function validateCache(body: unknown, wanted: readonly (readonly [string, number])[], total: number, provenance?: CacheProvenance) {
 const parsed = githubResponse.parse(body);
 assert.equal(parsed.data.total, total);
 assert.deepEqual(parsed.data.connection.repositories, cacheIdentities.filter((_, index) => index % 100 === 0).map(row => row[0]));
 assert.equal(parsed.data.connection.enabled, true); assert.equal(parsed.data.connection.version, 2); assert.equal(parsed.data.connection.lastError, null); assert.equal(parsed.data.connection.retryNotBefore, null); assert.equal(parsed.data.connection.busy, false);
 assert.deepEqual(parsed.data.items.map(item => [item.repository, item.number]), wanted);
 for (const item of parsed.data.items) { assert.equal(item.title, "Synthetic PR"); assert.equal(item.url, `https://github.com/${item.repository}/pull/${item.number}`); assert.equal(item.headSha, "a".repeat(40)); assert.equal(item.state, "open"); assert.equal(item.draft, false); assert.equal(item.baseBranch, "main"); assert.equal(item.mergedAt, null); assert.equal(item.previousHeadSha, null); assert.equal(item.lastError, null); assert.equal(item.headChanged, false);
  if (provenance) { const row = provenance.rows.find(row => row.repository === item.repository && row.number === item.number); assert(row); assert.equal(item.fetchedAt, new Date(row.fetched_at).toISOString()); assert.equal(item.lastAttemptedAt, new Date(row.last_attempted_at).toISOString()); } }
 if (provenance) { assert.equal(parsed.generation, provenance.generation); assert.equal(parsed.snapshotCursor, provenance.snapshotCursor); if (provenance.connection) { assert.equal(parsed.data.connection.lastAttemptedAt, provenance.connection.last_attempted_at === null ? null : new Date(provenance.connection.last_attempted_at).toISOString()); assert.equal(parsed.data.connection.lastFetchedAt, provenance.connection.last_fetched_at === null ? null : new Date(provenance.connection.last_fetched_at).toISOString()); }
  const scope = total === 1000 ? cacheIdentities : total === 100 ? cacheIdentities.filter(row => row[0] === wanted[0][0]) : wanted;
  const last = wanted.at(-1)!; assert.equal(parsed.data.nextCursor !== null, scope.findIndex(row => row[0] === last[0] && row[1] === last[1]) + 1 < scope.length);
  if (parsed.data.nextCursor) { const cursor = JSON.parse(Buffer.from(parsed.data.nextCursor, "base64url").toString("utf8")); assert.equal(cursor.generation, provenance.generation); assert.deepEqual(cursor.after, { repository: wanted.at(-1)![0], number: wanted.at(-1)![1] }); } }
 return parsed;
}
export function budgetFailures(groups: { round: number; base: { p95Ms: number }; head: { p95Ms: number }; cache: { p95Ms: number } }[]) {
 return groups.flatMap(group => [...(group.base.p95Ms >= 250 ? [`settings-base-${group.round}`] : []), ...(group.head.p95Ms >= 250 ? [`settings-head-${group.round}`] : []), ...(group.cache.p95Ms >= 250 ? [`cache-head-${group.round}`] : []), ...(group.head.p95Ms > group.base.p95Ms * 1.2 ? [`settings-regression-${group.round}`] : [])]);
}
export async function finishCapture(work: () => Promise<void>, close: () => Promise<void>, finalize: (primary: string | null, cleanup: string[]) => void) {
 let primary: unknown, cleanup: unknown, finalization: unknown;
 try { await work(); } catch (error) { primary = error; }
 try { await close(); } catch (error) { cleanup = error; }
 try { finalize(primary === undefined ? null : String(primary), cleanup === undefined ? [] : [String(cleanup)]); } catch (error) { finalization = error; }
 if (primary !== undefined) throw primary;
 if (cleanup !== undefined) throw cleanup;
 if (finalization !== undefined) throw finalization;
}
export type CaptureSample = { id: string; warmup: boolean; status: number | null; elapsedMs: number | null; failure: string | null; confirmed: boolean; text: string | null; generation: string | null; dispatchMs: number; drainedMs: number | null };
export function reconcile(declared: { id: string; warmup: boolean }[], samples: CaptureSample[], primary: string | null, cleanup: string[]) {
 const wanted = new Map(declared.map(row => [row.id, row])), counts = new Map<string, number>();
 for (const sample of samples) counts.set(sample.id, (counts.get(sample.id) ?? 0) + 1);
 const missing = declared.filter(row => !counts.has(row.id)).map(row => row.id), duplicate = [...counts].filter(([, count]) => count !== 1).map(([id]) => id), invalid: string[] = [];
 for (const row of samples) { const expected = wanted.get(row.id); let valid = !!expected && expected.warmup === row.warmup && row.status === 200 && row.elapsedMs !== null && Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0 && row.drainedMs !== null && row.drainedMs >= row.dispatchMs && Math.abs(row.elapsedMs - (row.drainedMs - row.dispatchMs)) < 0.000001;
  try { const body = JSON.parse(row.text!); valid = valid && typeof row.generation === "string" && body.generation === row.generation; } catch { valid = false; }
  if (!valid) invalid.push(row.id);
 }
 const failed = samples.filter(row => row.failure !== null).map(row => row.id), unconfirmed = samples.filter(row => !row.confirmed).map(row => row.id);
 return { declaredIds: declared.map(row => row.id), expected: declared.length, attempted: samples.length, attemptedIds: samples.map(row => row.id), missing, failed, unconfirmed, duplicate, invalid, primaryFailure: primary, cleanupFailures: cleanup, valid: new Set(declared.map(row => row.id)).size === declared.length && !missing.length && !failed.length && !unconfirmed.length && !duplicate.length && !invalid.length && primary === null && !cleanup.length };
}
export async function qualifiedService(options: Parameters<typeof boundedLaunch>[0], records: unknown[], work: (server: Awaited<ReturnType<typeof boundedLaunch>>, cookie: string) => Promise<void>, pair = boundedPair) {
 const record = { attempt: records.length + 1, source: options?.cwd, dataDir: options?.dir, pid: undefined as number | undefined, exitCode: null as number | null, signalCode: null as NodeJS.Signals | null, stdout: "", stderr: "", closed: false, phase: "launch", primaryFailure: null as string | null, cleanupFailure: null as string | null };
 records.push(record); let child: import("node:child_process").ChildProcess | undefined, server: Awaited<ReturnType<typeof boundedLaunch>> | undefined;
 let closed = Promise.resolve(); let primary: unknown, cleanup: unknown;
 try {
  server = await boundedLaunch({ ...options, onChild: observed => { child = observed; record.pid = observed.pid; observed.stdout!.on("data", chunk => record.stdout += chunk); observed.stderr!.on("data", chunk => record.stderr += chunk); closed = new Promise<void>(resolve => observed.once("close", (code, signal) => { record.closed = true; record.exitCode = code; record.signalCode = signal; resolve(); })); } });
  record.phase = "pair"; const cookie = await pair(server); record.phase = "work"; await work(server, cookie);
 } catch (error) { primary = error; record.primaryFailure = String(error); }
 try {
  if (server) await server.stop(); else if (child && !record.closed) await stop(child, "SIGTERM", options?.bounds ?? ownedBounds);
  await deadline(closed, options?.bounds?.killMs ?? ownedBounds.killMs, "QUALIFIED_OUTPUT_DRAIN_DEADLINE");
  assert(record.closed && record.exitCode === 0 && record.signalCode === null, "qualified graceful shutdown requires exit0 and null signal after output drain");
 } catch (error) { cleanup = error; record.cleanupFailure = String(error); }
 if (primary !== undefined) throw primary;
 if (cleanup !== undefined) throw cleanup;
 record.phase = "closed";
}
