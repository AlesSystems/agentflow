import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { launch } from "./server";
import { fixture, pairPage } from "./p03";
const out = ".impeccable/review/P05";
mkdirSync(out, { recursive: true });
let server = await launch();
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const page = await context.newPage();
const checks: unknown[] = [];
async function producer(path: string, body: unknown) {
  const response = await fetch(server.url + "/api/v1" + path, { method: "POST", headers: { Authorization: "Bearer " + server.credentials().reporterToken, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify(body) });
  expect(response.ok).toBeTruthy(); return (await response.json()).data;
}
async function capture(name: string) {
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
  const layout = await page.evaluate(() => ({ fonts: document.fonts.status, font: getComputedStyle(document.body).fontFamily, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, cssZoom: getComputedStyle(document.body).zoom }));
  expect(layout.fonts).toBe("loaded"); expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations).toEqual([]);
  checks.push({ name, layout, axeViolations: axe.violations });
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
}
try {
  const f = await fixture(page, server);
  const agent = await producer("/agents", { displayName: "Synthetic release inspector", source: "Public producer fixture with a deliberately long source identity", defaultRole: "implementation" });
  const runId = randomUUID();
  await producer("/runs", { id: runId, projectId: f.project.id, taskId: f.task.id, agentId: agent.id, purpose: "implementation", model: "Reported model name from external producer", expectedTaskVersion: 1 });
  for (const [sequence, type, payload] of [[1, "run.started", {}], [2, "run.progress", { message: "Inspecting the stored evidence. " + "A long synthetic report remains readable and expandable. ".repeat(12) }], [3, "run.succeeded", { summary: "Synthetic artifact ready for human review. This report does not accept the task.", evidenceUrl: "https://example.com/synthetic-p05-evidence" }]] as const)
    await producer(`/runs/${runId}/events`, { schemaVersion: 1, eventId: randomUUID(), runId, sequence, type, occurredAt: new Date().toISOString(), payload });
  await page.goto(server.url + "/agents"); await expect(page.getByText("Synthetic release inspector", { exact: true })).toBeVisible(); await capture("agents-desktop");
  await page.goto(server.url + "/activity"); await expect(page.getByText("Reported succeeded", { exact: true })).toBeVisible(); await capture("activity-desktop");
  await page.goto(f.boardUrl); await page.getByRole("button", { name: f.task.title, exact: true }).click(); await page.getByRole("button", { name: "implementation · Synthetic release inspector", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Raw reported events", exact: true })).toBeVisible();
  await page.getByRole("heading", { name: "Raw reported events", exact: true }).scrollIntoViewIfNeeded(); await capture("task-attempt-evidence");
  await page.goto(server.url + `/runs/${runId}`); await capture("attempt-desktop");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(server.url + "/agents"); await capture("agents-narrow");
  await page.goto(server.url + "/activity"); await capture("activity-narrow");
  await page.goto(server.url + `/runs/${runId}`); await capture("attempt-narrow");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const staleId = randomUUID();
  await producer("/runs", { id: staleId, projectId: f.project.id, agentId: agent.id, purpose: "planning" });
  await producer(`/runs/${staleId}/events`, { schemaVersion: 1, eventId: randomUUID(), runId: staleId, sequence: 1, type: "run.started", occurredAt: new Date().toISOString(), payload: {} });
  const dir = server.dir, port = server.port; await server.stop();
  const db = new Database(join(dir, "agentflow.sqlite")); db.prepare("UPDATE runs SET last_received_at=? WHERE id=?").run(Date.now() - 120000, staleId); db.close();
  server = await launch({ dir, port });
  await page.goto(server.url + `/runs/${staleId}`); await expect(page.getByText("running · Stale report · execution uncertain", { exact: true })).toBeVisible(); await expect(page.getByText("Connected updates", { exact: true })).toBeVisible(); await capture("stale-report-healthy-browser");
  const freshId = randomUUID(); await producer("/runs", { id: freshId, projectId: f.project.id, agentId: agent.id, purpose: "planning" });
  await producer(`/runs/${freshId}/events`, { schemaVersion: 1, eventId: randomUUID(), runId: freshId, sequence: 1, type: "run.started", occurredAt: new Date().toISOString(), payload: {} });
  await page.goto(server.url + `/runs/${freshId}`); await expect(page.getByText("running · Fresh report", { exact: true })).toBeVisible();
  await server.stop(); await expect(page.getByText("Polling for updates", { exact: true })).toBeVisible(); await capture("disconnected-browser-last-known-fresh-report"); server = await launch({ dir, port });
  const zoom = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "agentflow-p05-zoom-")), { channel: "chrome", headless: true, viewport: null, args: ["--window-size=1440,1000"] });
  const zoomPage = await zoom.newPage(); await pairPage(zoomPage, server); const before = await zoomPage.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio }));
  await zoomPage.goto("chrome://settings/appearance"); await zoomPage.locator("select#zoomLevel").selectOption("2"); await zoomPage.goto(server.url + "/activity"); await expect(zoomPage.getByText("Reported succeeded", { exact: true })).toBeVisible();
  await zoomPage.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
  const after = await zoomPage.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, cssZoom: getComputedStyle(document.body).zoom, scrollWidth: document.documentElement.scrollWidth, fonts: document.fonts.status }));
  expect(after.dpr).toBeGreaterThanOrEqual(before.dpr * 2); expect(after.cssZoom).toBe("1"); expect(after.scrollWidth).toBeLessThanOrEqual(after.width);
  await zoomPage.screenshot({ path: `${out}/activity-native-200.png`, fullPage: true }); checks.push({ name: "activity-native-200", before, after }); await zoom.close();
  const recording = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: out, size: { width: 1440, height: 1000 } } }); const recorded = await recording.newPage();
  await pairPage(recorded, server); await recorded.goto(server.url + `/runs/${freshId}`); await expect(recorded.getByText("Connected updates", { exact: true })).toBeVisible(); await server.stop(); await expect(recorded.getByText("Polling for updates", { exact: true })).toBeVisible(); await recorded.waitForTimeout(1500); server = await launch({ dir, port }); await expect(recorded.getByText("Connected updates", { exact: true })).toBeVisible({ timeout: 15000 }); await recorded.waitForTimeout(1500); const video = recorded.video()!; await recording.close(); copyFileSync(await video.path(), `${out}/reconnect.webm`);
  writeFileSync(`${out}/inspection.json`, JSON.stringify({ batch: 1, sourceScope: "P05 tracking surfaces", synthetic: true, staleCapture: "aged synthetic record; actual silence is separately proven by production e2e", checks }, null, 2));
} finally { await context.close(); await browser.close(); await server.stop(); }
