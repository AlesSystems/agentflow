import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { launch } from "../fixtures/server";
import { pairPage, command } from "../fixtures/p03";
test("successful native export header recovers Workspace before any copied result is used", async ({ page, browser }) => {
  test.setTimeout(40000);
  let releaseSse!: () => void;
  const sse = new Promise<void>(resolve => { releaseSse = resolve; });
  await page.route("**/api/v1/changes/stream?**", async route => { await sse; await route.abort(); });
  const server = await launch({ entry: "tests/fixtures/w03b-export-browser-runtime.ts", stdin: true });
  const other = await browser.newContext(), second = await other.newPage(), downloads: string[] = [], snapshots: unknown[] = [];
  const events = () => server.logs().split("\n").filter(line => line.startsWith("EXPORT_TEST ")).map(line => JSON.parse(line.slice(12)));
  page.on("download", download => { downloads.push(download.suggestedFilename()); });
  page.on("response", response => { if (response.url().endsWith("/api/v1/settings")) snapshots.push({ status: response.status(), generation: response.headers()["agentflow-generation"] }); });
  try {
    await pairPage(page, server); await pairPage(second, server); await page.goto(server.url + "/settings");
    await expect(page.getByText(/Saved timezone:.*version 2/)).toBeVisible();
    await command(second, "/projects", { name: "Synthetic copied history one" }); await command(second, "/projects", { name: "Synthetic copied history two" });
    const cutoff = new Date(Date.now() - 1).toISOString();
    await page.getByLabel("Tasks and protected facts", { exact: true }).check(); await page.getByLabel("UTC cutoff", { exact: true }).fill(cutoff);
    await page.getByRole("button", { name: "Preview prune", exact: true }).click(); await expect(page.getByRole("button", { name: "Confirm prune", exact: true })).toBeVisible();
    server.child.stdin!.write("hold\n"); await expect.poll(() => events().some(e => e.event === "held")).toBe(true);
    await page.getByRole("button", { name: "Download selected history", exact: true }).click();
    await expect.poll(() => events().some(e => e.event === "copied")).toBe(true);
    const copied = events().find(e => e.event === "copied");
    const prepared = await command(second, "/retention/preview", { cutoff: new Date(Date.now() - 1).toISOString() }), value = prepared.body.data;
    const pruned = await command(second, "/retention/prune", { previewId: value.previewId, expectedGeneration: value.expectedGeneration, expectedVersion: value.expectedVersion, candidateDigest: value.candidateDigest });
    expect(pruned.status).toBe(200); expect(pruned.body.generation).not.toBe(copied.manifest.generation);
    server.child.stdin!.write("release\n");
    await expect(page.getByText("Workspace changed. Download again using the current workspace. Your content selection is retained.", { exact: true })).toBeFocused();
    expect(downloads).toEqual([]);
    await expect(page.getByRole("button", { name: "Confirm prune", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("UTC cutoff", { exact: true })).toHaveValue(cutoff); await expect(page.getByLabel("Tasks and protected facts", { exact: true })).toBeChecked();
    await expect.poll(() => snapshots.some(s => (s as { generation: string }).generation === pruned.body.generation)).toBe(true);
    await expect(page.getByLabel("Timezone", { exact: true })).toBeVisible();
    const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Download selected history", exact: true }).click(); expect(await (await download).failure()).toBeNull();
    await expect.poll(() => events().filter(e => e.event === "wire").length).toBe(2);
    const wires = events().filter(e => e.event === "wire"); expect(wires[0].generation).toBe(pruned.body.generation); expect(JSON.parse(wires[0].body.split("\n")[0]).generation).toBe(copied.manifest.generation);
    expect(JSON.parse(wires[1].body.split("\n")[0]).generation).toBe(pruned.body.generation); expect(downloads).toEqual(["agentflow-history.jsonl"]);
    server.child.stdin!.write("diagnostics\n"); await expect.poll(() => events().find(e => e.event === "diagnostics")?.history.leases).toBe(0);
    expect(events().find(e => e.event === "diagnostics")).toMatchObject({ readersClosed: 2, exports: [] });
  } finally {
    server.child.stdin!.write("release\n"); releaseSse();
    if (process.env.W03B_EXPORT_REPAIR_PROOF_DIR) writeFileSync(join(process.env.W03B_EXPORT_REPAIR_PROOF_DIR, "native-browser.json"), JSON.stringify({ scopes: "synthetic native completed-copy/prune interleaving; browser SSE transport held; actual server header/body writer", downloads, snapshots, events: events(), dataDir: server.dir }, null, 2), { mode: 0o600 });
    await other.close(); await server.stop();
  }
});
