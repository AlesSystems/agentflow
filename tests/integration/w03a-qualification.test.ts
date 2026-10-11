import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { ChildProcess } from "node:child_process";
import { launch } from "../fixtures/server";
function childFixture(mode: string) {
 const dir = mkdtempSync(join(tmpdir(), "w03a-control-"));
 const entry = join(dir, "child.mjs");
 writeFileSync(entry, `import {createServer} from 'node:http'; console.log('original stdout'); console.error('original stderr'); ${mode === "startup" ? "process.exit(7);" : "const server=createServer((q,r)=>r.end('{}')); server.listen(Number(process.env.PORT),'127.0.0.1'); process.on('SIGTERM',()=>server.close(()=>{console.log('drained stdout');console.error('drained stderr');process.exit(0)}));"}`);
 return { dir, entry, bounds: { startupMs: 1500, healthMs: 100, terminateMs: 300, killMs: 300 } };
}
for (const mode of ["ready", "startup"]) it(`captures separate original child streams through ${mode} close`, async () => {
 let stdout = "", stderr = "", closed = false;
 const onChild = (child: ChildProcess) => { child.stdout!.on("data", chunk => stdout += chunk); child.stderr!.on("data", chunk => stderr += chunk); child.once("close", () => { closed = true; }); };
 const options = { ...childFixture(mode), onChild };
 if (mode === "startup") await expect(launch(options)).rejects.toThrow("launch exited 7");
 else { const server = await launch(options); await server.stop(); }
 expect(stdout).toContain("original stdout"); expect(stderr).toContain("original stderr"); expect(closed).toBe(true);
 if (mode === "ready") { expect(stdout).toContain("drained stdout"); expect(stderr).toContain("drained stderr"); }
});
import { createServer } from "node:http";
import { finishCapture, qualifiedService, budgetFailures, validateCache } from "../fixtures/w03a-qualification";
import { boundedFetch, readBoundedText } from "../fixtures/w01-runtime";
it("final reconciliation follows cleanup and preserves failed public originals and both errors", async () => {
 const remote = createServer((_req, res) => { res.statusCode = 503; res.end("synthetic failure body"); });
 await new Promise<void>(resolve => remote.listen(0, "127.0.0.1", resolve));
 const order: string[] = []; let final: unknown; let raw: unknown;
 const work = async () => { const response = await boundedFetch(`http://127.0.0.1:${(remote.address() as { port: number }).port}`); const text = await readBoundedText(response); raw = { status: response.status, text }; order.push("work"); throw Error("PUBLIC_503"); };
 await expect(finishCapture(work, async () => { await new Promise<void>(resolve => remote.close(() => resolve())); order.push("cleanup"); throw Error("CLEANUP_FAILED"); }, (primary, cleanup) => { order.push("final"); final = { primary, cleanup }; })).rejects.toThrow("PUBLIC_503");
 expect(raw).toEqual({ status: 503, text: "synthetic failure body" }); expect(order).toEqual(["work", "cleanup", "final"]); expect(final).toEqual({ primary: "Error: PUBLIC_503", cleanup: ["Error: CLEANUP_FAILED"] });
});
for (const mode of ["hang", "nonzero", "startup"]) it(`rejects and attributes ${mode} lifecycle failures after separate stream drain`, async () => {
 const options = childFixture(mode); const code = mode === "nonzero" ? 7 : 0;
 if (mode !== "startup") writeFileSync(options.entry, `import {createServer} from 'node:http'; console.log('original stdout'); console.error('original stderr'); const server=createServer((q,r)=>r.end('{}')); server.listen(Number(process.env.PORT),'127.0.0.1'); process.on('SIGTERM',()=>{${mode === "hang" ? "console.error('ignored shutdown');" : `server.close(()=>{console.log('drained stdout');console.error('drained stderr');process.exit(${code})});`}});`);
 const records: unknown[] = [];
 await expect(qualifiedService({ ...options, cwd: process.cwd() }, records, async () => {}, async () => "synthetic-cookie")).rejects.toThrow();
 expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ source: process.cwd(), dataDir: options.dir, closed: true, stdout: expect.stringContaining("original stdout"), stderr: expect.stringContaining("original stderr") });
 if (mode === "hang") expect(records[0]).toMatchObject({ exitCode: null, signalCode: "SIGKILL", cleanupFailure: expect.stringContaining("graceful") });
 else expect(records[0]).toMatchObject({ exitCode: 7, signalCode: null });
});
it("applies strict absolute250 to every settings/cache group and preserves regression approval", () => {
 expect(budgetFailures([{ round: 1, base: { p95Ms: 300 }, head: { p95Ms: 330 }, cache: { p95Ms: 249 } }])).toEqual(["settings-base-1", "settings-head-1"]);
 expect(budgetFailures([{ round: 2, base: { p95Ms: 250 }, head: { p95Ms: 250 }, cache: { p95Ms: 250 } }])).toEqual(["settings-base-2", "settings-head-2", "cache-head-2"]);
 expect(budgetFailures([{ round: 3, base: { p95Ms: 100 }, head: { p95Ms: 121 }, cache: { p95Ms: 249.99 } }])).toEqual(["settings-regression-3"]);
});
it("rejects schema-valid wrong seeded cache fields", () => {
 const item = { repository: "synthetic/repo0", number: 1, url: "https://github.com/synthetic/repo0/pull/1", title: "Synthetic PR", state: "open", draft: false, headSha: "a".repeat(40), baseBranch: "main", mergedAt: null, previousHeadSha: null, fetchedAt: "2026-10-11T12:00:00.000Z", lastAttemptedAt: "2026-10-11T12:00:00.000Z", lastError: null, stale: true, headChanged: false };
 const body = { generation: "11111111-1111-4111-8111-111111111111", snapshotCursor: "51", data: { connection: { enabled: true, repositories: Array.from({ length: 10 }, (_, i) => `synthetic/repo${i}`), version: 2, lastAttemptedAt: null, lastFetchedAt: null, lastError: null, retryNotBefore: null, credential: "configured", busy: false }, items: [item], total: 1, nextCursor: null, lookupAttempt: null } };
 expect(validateCache(body, [["synthetic/repo0", 1]], 1).data.items[0].state).toBe("open");
 for (const wrong of [{ state: "closed" }, { draft: true }, { baseBranch: "wrong" }, { mergedAt: "2026-10-11T13:00:00.000Z" }, { previousHeadSha: "b".repeat(40) }, { lastError: "offline" }, { headChanged: true }]) expect(() => validateCache({ ...body, data: { ...body.data, items: [{ ...item, ...wrong }] } }, [["synthetic/repo0", 1]], 1)).toThrow();
});
