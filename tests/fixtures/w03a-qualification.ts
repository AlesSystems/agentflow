import assert from "node:assert/strict";
import { githubResponse } from "../../src/contracts/github";
import { boundedLaunch, boundedPair } from "./w01-runtime";
export const cacheIdentities = Array.from({ length: 10 }, (_, repository) => Array.from({ length: 100 }, (_, number) => [`synthetic/repo${repository}`, number + 1] as const)).flat();
export function validateCache(body: unknown, wanted: readonly (readonly [string, number])[], total: number) {
 const parsed = githubResponse.parse(body);
 assert.equal(parsed.data.total, total);
 assert.deepEqual(parsed.data.connection.repositories, cacheIdentities.filter((_, index) => index % 100 === 0).map(row => row[0]));
 assert.equal(parsed.data.connection.enabled, true);
 assert.deepEqual(parsed.data.items.map(item => [item.repository, item.number]), wanted);
 for (const item of parsed.data.items) { assert.equal(item.title, "Synthetic PR"); assert.equal(item.url, `https://github.com/${item.repository}/pull/${item.number}`); assert.equal(item.headSha, "a".repeat(40)); }
 return parsed;
}
export function budgetFailures(groups: { round: number; base: { p95Ms: number }; head: { p95Ms: number }; cache: { p95Ms: number } }[]) {
 return groups.flatMap(group => [...(group.cache.p95Ms >= 250 ? [`cache-head-${group.round}`] : []), ...(group.head.p95Ms > group.base.p95Ms * 1.2 ? [`settings-regression-${group.round}`] : [])]);
}
export async function finishCapture(work: () => Promise<void>, close: () => Promise<void>, finalize: (primary: string | null, cleanup: string[]) => void) {
 try { await work(); finalize(null, []); }
 finally { await close(); }
}
export async function qualifiedService(options: Parameters<typeof boundedLaunch>[0], records: unknown[], work: (server: Awaited<ReturnType<typeof boundedLaunch>>, cookie: string) => Promise<void>, pair = boundedPair) {
 const server = await boundedLaunch(options);
 try { await work(server, await pair(server)); }
 finally { await server.stop(); records.push({ source: options?.cwd, dataDir: options?.dir, pid: server.child.pid, exitCode: server.child.exitCode, signalCode: server.child.signalCode, logs: server.logs() }); }
}
