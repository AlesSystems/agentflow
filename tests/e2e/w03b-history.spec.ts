import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { test, expect, chromium, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { launch } from "../fixtures/server";
import { pairPage, command } from "../fixtures/p03";
import { reportedWorkflow } from "../fixtures/w01-producer";
const proof = process.env.W03B_TASK4_PROOF_DIR;
test.use({ actionTimeout: 10000, navigationTimeout: 15000 });

async function passiveReset(second: Page) {
  const prepared = await command(second, "/retention/preview", { cutoff: new Date(Date.now() - 1).toISOString() });
  expect(prepared.status).toBe(200);
  const value = prepared.body.data;
  const applied = await command(second, "/retention/prune", { previewId: value.previewId, expectedGeneration: value.expectedGeneration, expectedVersion: value.expectedVersion, candidateDigest: value.candidateDigest });
  expect(applied.status).toBe(200);
  return { prepared, applied };
}
function saveFocusProof(name: string, value: unknown) {
  if (process.env.W03B_TASK4_FOCUS_PROOF_DIR) writeFileSync(join(process.env.W03B_TASK4_FOCUS_PROOF_DIR, name + ".json"), JSON.stringify(value, null, 2), { mode: 0o600 });
}
for (const control of ["Confirm prune", "Cancel preview"]) {
  test(`passive generation reset recovers focused ${control}`, async ({ page, browser }) => {
    const server = await launch(), other = await browser.newContext(), second = await other.newPage();
    try {
      await pairPage(page, server); await pairPage(second, server); await page.goto(server.url + "/settings");
      await command(second, "/projects", { name: "Synthetic focus fact one" }); await command(second, "/projects", { name: "Synthetic focus fact two" });
      const cutoff = new Date(Date.now() - 1).toISOString(); await preview(page, cutoff);
      await expect(page.getByText("Preview ready. Review the counts before confirming.", { exact: true })).toBeFocused();
      await page.getByRole("button", { name: control, exact: true }).focus(); await expect(page.getByRole("button", { name: control, exact: true })).toBeFocused();
      const reset = await passiveReset(second);
      await expect(page.getByRole("button", { name: "Cancel preview", exact: true })).toHaveCount(0);
      const active = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent }));
      saveFocusProof(control === "Confirm prune" ? "confirm" : "cancel", { scope: "synthetic independently paired Chrome sessions; passive actual prune generation", control, cutoff, reset, active });
      await expect(page.getByRole("button", { name: "Preview prune", exact: true })).toBeFocused();
      await expect(page.getByLabel("UTC cutoff", { exact: true })).toHaveValue(cutoff);
    } finally { await other.close(); await server.stop(); }
  });
}
test("passive generation reset leaves history draft editing focused", async ({ page, browser }) => {
  const server = await launch(), other = await browser.newContext(), second = await other.newPage();
  try {
    await pairPage(page, server); await pairPage(second, server); await page.goto(server.url + "/settings");
    await command(second, "/projects", { name: "Synthetic retained focus fact one" }); await command(second, "/projects", { name: "Synthetic retained focus fact two" });
    const cutoff = new Date(Date.now() - 1).toISOString(); await preview(page, cutoff);
    await expect(page.getByText("Preview ready. Review the counts before confirming.", { exact: true })).toBeFocused();
    const input = page.getByLabel("UTC cutoff", { exact: true }); await input.focus();
    const reset = await passiveReset(second);
    await expect(page.getByRole("button", { name: "Cancel preview", exact: true })).toHaveCount(0);
    await expect(input).toBeFocused(); await expect(input).toHaveValue(cutoff);
    await input.fill("1970-01-01T00:00:00.000Z"); await expect(input).toBeFocused();
    const active = await input.evaluate(element => ({ tag: document.activeElement?.tagName, same: document.activeElement === element, value: (element as HTMLInputElement).value }));
    saveFocusProof("draft", { scope: "synthetic independently paired Chrome sessions; no preview focus ownership", reset, active });
  } finally { await other.close(); await server.stop(); }
});

test("unavailable export names download recovery and retains selected content", async ({ page }) => {
  const server = await launch();
  try {
    await pairPage(page, server); await page.goto(server.url + "/settings");
    await page.getByLabel("Tasks and protected facts", { exact: true }).check();
    await page.getByLabel("Workflow history", { exact: true }).check();
    await page.route("**/api/v1/export?**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable" } }) }));
    await press(page, "Download selected history");
    await expect(page.getByText("Local storage is busy or unavailable. Retry the selected download. Your content selection is retained.", { exact: true })).toBeFocused();
    await expect(page.getByLabel("Tasks and protected facts", { exact: true })).toBeChecked();
    await expect(page.getByLabel("Workflow history", { exact: true })).toBeChecked();
    await capture(page, "export-unavailable");
    await page.unroute("**/api/v1/export?**");
    const downloaded = page.waitForEvent("download"); await press(page, "Download selected history");
    expect(await (await downloaded).failure()).toBeNull();
    await expect(page.getByText(/Complete selected history downloaded/)).toBeVisible();
  } finally { await server.stop(); }
});
const read = (page: Page, path: string) => page.evaluate(async path => (await (await fetch("/api/v1" + path)).json()), path);
async function press(page: Page, name: string) { await page.getByRole("button", { name, exact: true }).focus(); await page.keyboard.press("Enter"); }
async function preview(page: Page, cutoff: string) {
  await page.getByLabel("UTC cutoff", { exact: true }).fill(cutoff);
  await press(page, "Preview prune");
  await expect(page.getByRole("heading", { name: "Prune preview", exact: true })).toBeVisible();
}
async function capture(page: Page, name: string) {
  if (!proof) return;
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: join(proof, name + "-private.png"), fullPage: true, animations: "disabled" });
  await page.screenshot({ path: join(proof, name + ".png"), fullPage: true, animations: "disabled", mask: [page.locator(".settings-section dd.break-word")], maskColor: "#e8e1d7" });
}

test("history selection requires a deliberate preview before prune", async ({ page }) => {
  const server = await launch();
  try {
    await pairPage(page, server);
    await page.goto(server.url + "/settings");
    await expect(page.getByRole("heading", { name: "Export history", exact: true })).toBeVisible();
    await expect(page.getByText("All history is retained until you explicitly prune.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download selected history", exact: true })).toBeDisabled();
    await page.getByLabel("Tasks and protected facts", { exact: true }).check();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download selected history", exact: true }).click();
    expect(await (await download).failure()).toBeNull();
    await expect(page.getByRole("button", { name: "Confirm prune", exact: true })).toHaveCount(0);
    await page.getByLabel("UTC cutoff", { exact: true }).fill("1970-01-01T00:00:00.000Z");
    await page.getByRole("button", { name: "Preview prune", exact: true }).click();
    await expect(page.getByText("No eligible history before this cutoff. Everything is retained.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm prune", exact: true })).toHaveCount(0);
  } finally { await server.stop(); }
});

test("real SQLite busy and session repair retain selection and cutoff", async ({ page }) => {
  const server = await launch();
  const wires: { key?: string; body: string | null }[] = [];
  try {
    await pairPage(page, server); await page.goto(server.url + "/settings");
    await command(page, "/projects", { name: "Synthetic busy fact one" }); await command(page, "/projects", { name: "Synthetic busy fact two" });
    await page.getByLabel("Tasks and protected facts", { exact: true }).check();
    const cutoff = new Date(Date.now() - 1).toISOString(); await preview(page, cutoff);
    page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/retention/prune")) wires.push({ key: r.headers()["idempotency-key"], body: r.postData() }); });
    const db = new Database(join(server.dir, "agentflow.sqlite"));
    try {
      db.exec("BEGIN IMMEDIATE"); await press(page, "Confirm prune");
      await expect(page.getByText(/Local storage is busy or the safety backup is unavailable/)).toBeFocused();
    } finally { db.exec("ROLLBACK"); db.close(); }
    await press(page, "Retry exact prune request"); await expect(page.getByText(/Workspace changed. Your drafts are retained/)).toBeVisible();
    await press(page, "Retry exact prune request"); await expect(page.getByText(/Prune recorded:/)).toBeVisible();
    expect(wires).toHaveLength(3); for (const wire of wires) expect(wire).toEqual(wires[0]);
    const revoke = new Database(join(server.dir, "agentflow.sqlite")); revoke.prepare("DELETE FROM sessions").run(); revoke.close();
    await press(page, "Preview prune");
    const modal = page.getByRole("dialog", { name: "Pair again to keep editing", exact: true }); await expect(modal).toBeVisible();
    await modal.getByLabel("Pairing token", { exact: true }).fill(server.credentials().pairingToken); await modal.getByRole("button", { name: "Pair this browser", exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByLabel("UTC cutoff", { exact: true })).toHaveValue(cutoff); await expect(page.getByLabel("Tasks and protected facts", { exact: true })).toBeChecked();
    await press(page, "Preview prune"); await expect(page.getByRole("heading", { name: "Prune preview", exact: true })).toBeVisible();
  } finally { await server.stop(); }
});

test("offline, unavailable backup, expired preview and incomplete export retain deliberate drafts", async ({ page }) => {
  const server = await launch();
  try {
    await pairPage(page, server); await page.goto(server.url + "/settings");
    await page.getByLabel("Tasks and protected facts", { exact: true }).check();
    await command(page, "/projects", { name: "Synthetic first history fact" });
    await command(page, "/projects", { name: "Synthetic second history fact" });
    const cutoff = new Date(Date.now() - 1).toISOString();
    await page.getByLabel("UTC cutoff", { exact: true }).fill(cutoff);
    await page.context().setOffline(true); await press(page, "Preview prune");
    await expect(page.getByText("Local browser is offline. Your cutoff and content selection are retained.", { exact: true })).toBeFocused();
    await page.context().setOffline(false); await preview(page, cutoff);
    await press(page, "Cancel preview"); await expect(page.getByText("Preview cancelled. All history is retained.", { exact: true })).toBeFocused();
    await preview(page, cutoff);
    const db = new Database(join(server.dir, "agentflow.sqlite"));
    db.prepare("DELETE FROM retention_previews WHERE NOT EXISTS (SELECT 1 FROM retention_consumptions WHERE preview_id=retention_previews.id)").run(); db.close();
    await press(page, "Confirm prune"); await expect(page.getByText("Preview expired or history changed. Prepare another preview before confirming.", { exact: true })).toBeFocused();
    await expect(page.getByRole("button", { name: "Retry exact prune request", exact: true })).toHaveCount(0);
    await press(page, "Prepare another preview"); await expect(page.getByRole("heading", { name: "Prune preview", exact: true })).toBeVisible();
    const before = (await read(page, "/settings")).generation;
    writeFileSync(join(server.dir, "backups"), "Synthetic backup obstruction", { mode: 0o600 });
    await press(page, "Confirm prune"); await expect(page.getByText(/Local storage is busy or the safety backup is unavailable/)).toBeFocused();
    expect((await read(page, "/settings")).generation).toBe(before);
    await expect(page.getByLabel("UTC cutoff", { exact: true })).toHaveValue(cutoff);
    await expect(page.getByLabel("Tasks and protected facts", { exact: true })).toBeChecked();
    unlinkSync(join(server.dir, "backups")); await press(page, "Retry exact prune request");
    await expect(page.getByText(/Workspace changed. Your drafts are retained/)).toBeVisible();
    await press(page, "Retry exact prune request"); await expect(page.getByText(/Prune recorded:/)).toBeVisible();
    await page.route("**/api/v1/export?**", async route => { const response = await route.fetch(); const text = await response.text(); await route.fulfill({ response, body: text.trimEnd().split("\n").slice(0, -1).join("\n") + "\n" }); });
    await press(page, "Download selected history"); await expect(page.getByText("Export did not complete. No complete history file was downloaded. Retry the download.", { exact: true })).toBeFocused();
    await page.unroute("**/api/v1/export?**");
    await page.getByLabel("UTC cutoff", { exact: true }).fill("not a UTC time"); await press(page, "Preview prune");
    await expect(page.getByText(/Enter a past UTC cutoff ending in Z/)).toBeFocused();
  } finally { await server.stop(); }
});

test("history controls fit desktop and 375px, native Chrome 200 percent zoom and keyboard", async ({ page }) => {
  test.setTimeout(60000);
  const server = await launch();
  try {
    await pairPage(page, server); await page.goto(server.url + "/settings");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await command(page, "/projects", { name: "Synthetic preview fact one" });
    await command(page, "/projects", { name: "Synthetic preview fact two" });
    await page.getByLabel("Tasks and protected facts", { exact: true }).check();
    await preview(page, new Date(Date.now() - 1).toISOString());
    await expect(page.getByRole("button", { name: "Confirm prune", exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).include(".history-settings").analyze()).violations).toEqual([]);
    await capture(page, "settings-desktop");
    await page.setViewportSize({ width: 375, height: 812 }); await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).include(".history-settings").analyze()).violations).toEqual([]);
    await capture(page, "settings-narrow");
  } finally { await server.stop(); }
  const zoomServer = await launch(), context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "w03b-zoom-")), { channel: "chrome", headless: true, viewport: null, args: ["--window-size=1440,1000"] }), zoomPage = await context.newPage();
  try {
    await pairPage(zoomPage, zoomServer); const before = await zoomPage.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio }));
    await command(zoomPage, "/projects", { name: "Synthetic zoom fact one" }); await command(zoomPage, "/projects", { name: "Synthetic zoom fact two" });
    await zoomPage.goto("chrome://settings/appearance"); await zoomPage.locator("select#zoomLevel").selectOption("2"); await zoomPage.goto(zoomServer.url + "/settings");
    await expect(zoomPage.getByRole("heading", { name: "Export history", exact: true })).toBeVisible();
    const after = await zoomPage.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, cssZoom: getComputedStyle(document.body).zoom }));
    expect(after.width).toBeLessThan(before.width * 0.6); expect(after.dpr).toBeGreaterThan(before.dpr * 1.9); expect(after.cssZoom).toBe("1");
    await zoomPage.getByLabel("Tasks and protected facts", { exact: true }).focus(); await zoomPage.keyboard.press("Space");
    const download = zoomPage.waitForEvent("download"); await press(zoomPage, "Download selected history"); expect(await (await download).failure()).toBeNull();
    await preview(zoomPage, new Date(Date.now() - 1).toISOString()); await press(zoomPage, "Cancel preview");
    await expect(zoomPage.getByText("Preview cancelled. All history is retained.", { exact: true })).toBeFocused();
    await preview(zoomPage, new Date(Date.now() - 1).toISOString()); await press(zoomPage, "Confirm prune");
    await expect(zoomPage.getByText(/Workspace changed. Your drafts are retained/)).toBeFocused(); await press(zoomPage, "Retry exact prune request");
    await expect(zoomPage.getByText(/Prune recorded:/)).toBeFocused();
    expect(await zoomPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page: zoomPage }).include(".history-settings").analyze()).violations).toEqual([]);
    if (proof) {
      const session = await context.newCDPSession(zoomPage); await zoomPage.locator(".history-settings").scrollIntoViewIfNeeded();
      const metrics = await session.send("Page.getLayoutMetrics"), shot = await session.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false }), bytes = Buffer.from(shot.data, "base64");
      expect(bytes.readUInt32BE(16)).toBe(metrics.layoutViewport.clientWidth);
      writeFileSync(join(proof, "history-native-200.png"), bytes, { mode: 0o600 });
      writeFileSync(join(proof, "native-zoom.json"), JSON.stringify({ before, after, metrics, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), scopes: "history controls only; actual browser zoom, not CSS scale" }, null, 2), { mode: 0o600 }); await session.detach();
    }
  } finally { await context.close(); await zoomServer.stop(); }
});

test("paired sessions preserve drafts and graph facts through normal and lost prune replies, with real complete downloads", async ({ page, browser }) => {
  test.setTimeout(120000);
  const server = await launch(), other = await browser.newContext(), second = await other.newPage();
  const wires: { key?: string; body: string | null }[] = [], replies: unknown[] = [];
  try {
    const f = await reportedWorkflow(server);
    const verification = await f.cli(["report", "--run", f.verificationRunId, "--type", "run.succeeded", "--payload", f.file({ summary: "Synthetic finished verification" })]);
    expect(verification.code).toBe(0);
    await pairPage(page, server); await pairPage(second, server);
    const current = await read(page, `/tasks/${f.taskId}`);
    expect((await command(page, `/tasks/${f.taskId}/complete`, { expectedVersion: current.data.task.version, evidenceNote: "Synthetic browser-role acceptance only" })).status).toBe(201);
    const accepted = await read(page, `/tasks/${f.taskId}`);
    const draftTask = await command(page, "/tasks", { projectId: f.projectId, title: "Synthetic editable work" });
    expect(draftTask.status).toBe(201);
    const planningRun = randomUUID(), progressId = randomUUID();
    expect((await command(page, "/runs", { id: planningRun, projectId: f.projectId, agentId: f.agentId, purpose: "planning" })).status).toBe(201);
    for (const [sequence, type, payload] of [[1, "run.started", {}], [2, "run.progress", { message: "Synthetic removable planning text" }], [3, "run.heartbeat", {}], [4, "run.cancelled", { reason: "Synthetic terminal fact retained" }]] as const) {
      expect((await command(page, `/runs/${planningRun}/events`, { schemaVersion: 1, eventId: sequence === 2 ? progressId : randomUUID(), runId: planningRun, sequence, type, payload, occurredAt: new Date().toISOString() })).status).toBe(201);
    }
    const graphOne = await page.context().newPage(), graphTwo = await other.newPage(), board = await page.context().newPage(), task = await other.newPage();
    await graphOne.goto(f.url); await graphTwo.goto(f.url);
    for (const graph of [graphOne, graphTwo]) { await expect(graph.getByText(f.verificationReport.eventId, { exact: true })).toBeVisible(); await expect(graph.getByText("Human accepted", { exact: true }).first()).toBeVisible(); }
    await board.setViewportSize({ width: 375, height: 812 });
    await board.goto(server.url + `/projects/${f.projectId}`);
    await board.getByRole("combobox", { name: "Show status", exact: true }).selectOption("backlog");
    await board.getByRole("button", { name: "Synthetic editable work", exact: true }).click();
    await board.getByLabel("Title", { exact: true }).fill("Synthetic retained board draft");
    await task.goto(server.url + `/projects/${f.projectId}/tasks/${draftTask.body.data.id}`);
    await task.getByLabel("Title", { exact: true }).fill("Synthetic retained task draft");
    await page.goto(server.url + "/settings"); await second.goto(server.url + "/settings");
    await expect(page.getByLabel("Timezone", { exact: true })).toBeVisible();
    await second.getByLabel("Tasks and protected facts", { exact: true }).check();
    const cutoff = new Date(Date.now() - 1).toISOString();
    await preview(page, cutoff); await preview(second, cutoff);
    await second.getByLabel("Timezone", { exact: true }).fill("Europe/London");
    await expect(page.locator(".retention-preview").getByText("2 · No further eligible payloads", { exact: true })).toBeVisible();
    const stale = await command(page, "/retention/preview", { cutoff });
    const staleInput = { previewId: stale.body.data.previewId, expectedGeneration: stale.body.data.expectedGeneration, expectedVersion: stale.body.data.expectedVersion, candidateDigest: stale.body.data.candidateDigest };
    const originalGeneration = stale.body.generation;
    page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/retention/prune")) wires.push({ key: r.headers()["idempotency-key"], body: r.postData() }); });
    await press(page, "Confirm prune");
    await expect(page.getByText(/Workspace changed. Your drafts are retained. Retry the exact prune request/)).toBeFocused();
    await press(page, "Retry exact prune request");
    await expect(page.getByText(/Prune recorded: 2 event payloads/)).toBeVisible();
    expect(wires).toHaveLength(2); expect(wires[0]).toEqual(wires[1]);
    await expect(second.getByRole("button", { name: "Confirm prune", exact: true })).toHaveCount(0);
    await expect(second.getByText("Workspace changed. Prepare another preview. Your cutoff is retained.", { exact: true })).toBeVisible();
    await expect(second.getByLabel("UTC cutoff", { exact: true })).toHaveValue(cutoff);
    await expect(second.getByLabel("Tasks and protected facts", { exact: true })).toBeChecked();
    await expect(second.getByLabel("Timezone", { exact: true })).toHaveValue("Europe/London");
    await expect(board.getByLabel("Title", { exact: true })).toHaveValue("Synthetic retained board draft");
    await expect(task.getByLabel("Title", { exact: true })).toHaveValue("Synthetic retained task draft");
    for (const graph of [graphOne, graphTwo]) { await expect(graph.getByText(f.verificationReport.eventId, { exact: true })).toBeVisible(); await expect(graph.getByText("Human accepted", { exact: true }).first()).toBeVisible(); await expect(graph.getByText("Prerequisites ready", { exact: true }).first()).toBeVisible(); }
    const afterNormal = await read(page, `/tasks/${f.taskId}`);
    expect(afterNormal.data).toEqual(accepted.data); expect(afterNormal.generation).not.toBe(originalGeneration);
    const staleRejected = await command(second, "/retention/prune", staleInput); expect(staleRejected.status).toBe(409); expect(staleRejected.body.error.code).toBe("preview_changed");
    for (const tab of [page, second, board, task, graphOne, graphTwo]) await expect(tab.getByRole("dialog", { name: "Pair again to keep editing", exact: true })).toHaveCount(0);
    const db = new Database(join(server.dir, "agentflow.sqlite"));
    const copy = join(server.dir, "task4-retained-copy.sqlite"); await db.backup(copy); db.close();
    await page.getByLabel("Attempts and raw reports", { exact: true }).focus(); await page.keyboard.press("Space");
    const downloaded = page.waitForEvent("download"); await press(page, "Download selected history"); const download = await downloaded; expect(await download.failure()).toBeNull();
    const saved = proof ? join(proof, "selected-history.jsonl") : join(server.dir, "selected-history.jsonl"); await download.saveAs(saved);
    const text = readFileSync(saved, "utf8"), lines = text.trim().split("\n").map(line => JSON.parse(line)), manifest = lines[0], complete = lines.at(-1);
    const retained = new Database(copy, { readonly: true });
    const counts = { run: (retained.prepare("SELECT count(*) AS n FROM runs").get() as { n: number }).n, runEvent: (retained.prepare("SELECT count(*) AS n FROM run_events").get() as { n: number }).n, usageMeasurement: (retained.prepare("SELECT count(*) AS n FROM usage_measurements").get() as { n: number }).n, usagePriceSnapshot: (retained.prepare("SELECT count(*) AS n FROM usage_price_snapshots").get() as { n: number }).n }; retained.close();
    expect(manifest.content).toEqual(["attempts"]); expect(manifest.generation).toBe(afterNormal.generation); expect(manifest.counts).toEqual(counts); expect(complete).toEqual({ kind: "complete", schemaVersion: 2, counts });
    expect(lines.filter(line => line.kind === "run")).toHaveLength(counts.run); expect(lines.filter(line => line.kind === "runEvent")).toHaveLength(counts.runEvent);
    expect(lines.find(line => line.kind === "runEvent" && line.data.eventId === progressId).data).toMatchObject({ type: "run.progress", sequence: 2, payload: null, payloadPrunedAt: expect.any(String) });
    expect(text).not.toContain("Synthetic removable planning text"); expect(text).not.toContain(server.dir); expect(text).not.toContain(server.credentials().pairingToken);
    await page.goto(server.url + `/runs/${planningRun}`); await expect(page.getByText(/Payload unavailable · pruned/).first()).toBeVisible(); await expect(page.getByText("2 · run.progress", { exact: true })).toBeVisible();
    await page.goto(server.url + "/activity"); await expect(page.getByText(/Payload unavailable · pruned/).first()).toBeVisible(); await expect(page.getByText("Reported progress", { exact: true })).toBeVisible();
    await page.goto(server.url + "/settings");
    const beforeLost = (await read(page, "/settings")).generation;
    await preview(page, new Date(Date.now() - 1).toISOString());
    await page.route("**/api/v1/retention/prune", async route => { const result = await route.fetch(); expect(result.status()).toBe(200); replies.push({ status: result.status(), generation: result.headers()["agentflow-generation"], body: await result.json() }); await route.abort("failed"); await page.unroute("**/api/v1/retention/prune"); });
    await press(page, "Confirm prune"); await expect(page.getByText(/Response is uncertain/)).toBeFocused();
    await page.getByLabel("UTC cutoff", { exact: true }).fill("1970-01-01T00:00:00.000Z");
    await press(page, "Retry exact prune request");
    await expect(page.getByText(/Prune recorded:|Workspace changed. Your drafts are retained/)).toBeVisible();
    if (await page.getByText(/Workspace changed. Your drafts are retained/).isVisible()) await press(page, "Retry exact prune request");
    await expect(page.getByText(/Prune recorded: 0 event payloads/)).toBeVisible();
    const afterLost = (await read(page, "/settings")).generation;
    expect(afterLost).not.toBe(beforeLost); expect(afterLost).toBe((replies[0] as { generation: string }).generation);
    for (const wire of wires.slice(2)) expect(wire).toEqual(wires[2]);
    await expect(page.getByLabel("UTC cutoff", { exact: true })).toHaveValue("1970-01-01T00:00:00.000Z");
    expect((await read(page, `/tasks/${f.taskId}`)).data).toEqual(accepted.data);
    expect(readdirSync(join(server.dir, "backups")).filter(name => name.startsWith("retention-") && name.endsWith(".sqlite"))).toHaveLength(2);
    await expect(second.getByLabel("UTC cutoff", { exact: true })).toHaveValue(cutoff);
    await expect(second.getByLabel("Tasks and protected facts", { exact: true })).toBeChecked();
    await expect(board.getByLabel("Title", { exact: true })).toHaveValue("Synthetic retained board draft");
    await expect(task.getByLabel("Title", { exact: true })).toHaveValue("Synthetic retained task draft");
    for (const graph of [graphOne, graphTwo]) { await expect(graph.getByText(f.verificationReport.eventId, { exact: true })).toBeVisible(); await expect(graph.getByText("Human accepted", { exact: true }).first()).toBeVisible(); }
    if (proof) writeFileSync(join(proof, "browser-contract.json"), JSON.stringify({ scopes: "synthetic independently paired Chrome sessions; not a human attestation", dir: server.dir, wires, replies, accepted, afterNormal, beforeLost, afterLost, counts, retainedCopy: copy, downloadSha256: createHash("sha256").update(text).digest("hex") }, null, 2), { mode: 0o600 });
  } finally { await other.close(); await server.stop(); }
});
