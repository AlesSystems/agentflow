import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { restore } from "../../src/db/recovery";
import { launch } from "../fixtures/server";
import { fixture, pairPage, command } from "../fixtures/p03";
async function producer(server: Awaited<ReturnType<typeof launch>>, path: string, body: unknown) {
  const response = await fetch(server.url + "/api/v1" + path, { method: "POST", headers: { Authorization: "Bearer " + server.credentials().reporterToken, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify(body) });
  expect(response.ok).toBeTruthy(); return await response.json();
}
async function streamCounter(page: Page) {
  await page.addInitScript(() => {
    const Original = window.EventSource;
    const state = { open: 0, peak: 0 };
    Object.assign(window, { streamCounts: state });
    window.EventSource = class extends Original {
      private closed = false;
      constructor(url: string | URL, options?: EventSourceInit) { super(url, options); state.open++; state.peak = Math.max(state.peak, state.open); }
      close() { if (!this.closed) { this.closed = true; state.open--; } super.close(); }
    };
  });
}
test("two production tabs converge and silence alone becomes stale while the browser stays connected", async ({ page, browser }) => {
  test.setTimeout(110000);
  let server = await launch();
  const other = await browser.newContext();
  const second = await other.newPage();
  await streamCounter(page); await streamCounter(second);
  try {
    const f = await fixture(page, server);
    await pairPage(second, server);
    const agent = await producer(server, "/agents", { displayName: "Synthetic P05 producer", source: "public HTTP", defaultRole: "implementation" });
    const runId = randomUUID();
    await producer(server, "/runs", { id: runId, projectId: f.project.id, taskId: f.task.id, agentId: agent.data.id, purpose: "implementation", expectedTaskVersion: 1 });
    await page.goto(f.boardUrl);
    await second.goto(server.url);
    await expect(page.getByText("Connected updates", { exact: true })).toBeVisible();
    await expect(second.getByText("Connected updates", { exact: true })).toBeVisible();
    const event = { schemaVersion: 1, eventId: randomUUID(), runId, sequence: 1, type: "run.started", occurredAt: new Date().toISOString(), payload: {} };
    const accepted = await producer(server, `/runs/${runId}/events`, event);
    const received = Date.parse(accepted.data.receivedAt);
    await expect(page.getByText("running · Fresh report", { exact: true })).toBeVisible();
    await expect(second.locator(".metrics > div").filter({ hasText: "Reporting agents" }).locator("dd")).toHaveText("1");
    expect(Date.now() - received).toBeLessThan(2000);
    for (const tab of [page, second]) expect(await tab.evaluate(() => (window as unknown as { streamCounts: { open: number; peak: number } }).streamCounts)).toEqual({ open: 1, peak: 1 });
    // No write or navigation occurs during this real silence interval.
    await expect(page.getByText("running · Stale report · execution uncertain", { exact: true })).toBeVisible({ timeout: 75000 });
    expect(Date.now() - received).toBeGreaterThan(60000);
    expect(Date.now() - received).toBeLessThan(75000);
    await expect(second.locator(".metrics > div").filter({ hasText: "Reporting agents" }).locator("dd")).toHaveText("0");
    await expect(page.getByText("Connected updates", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await page.getByRole("button", { name: "implementation · Synthetic P05 producer", exact: true }).click();
    await page.getByRole("button", { name: "Close stale tracking", exact: true }).click();
    await page.getByLabel("Reason", { exact: true }).fill("Synthetic external ownership uncertain");
    await page.getByRole("button", { name: "Confirm tracking closure", exact: true }).click();
    await expect(page.getByText("Tracking record closed. No process signal was sent.", { exact: true })).toBeVisible();
    await expect(page.locator(".run-detail .report-label")).toHaveText("interrupted · Terminal record");
    const dir = server.dir, port = server.port;
    await server.stop();
    await expect(page.getByText("Polling for updates", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: f.task.title, exact: true })).toBeVisible();
    server = await launch({ dir, port });
    await expect(page.getByText("Connected updates", { exact: true })).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => (window as unknown as { streamCounts: { open: number } }).streamCounts.open)).toBe(1);
  } finally { await other.close(); await server.stop(); }
});
test("stored activity, direct attempt routes and raw history expose reports and preserve closure reason", async ({ page }) => {
  const server = await launch();
  try {
    const f = await fixture(page, server);
    const agent = await producer(server, "/agents", { displayName: "Synthetic history producer", source: "public HTTP", defaultRole: "implementation" });
    const runId = randomUUID();
    await producer(server, "/runs", { id: runId, projectId: f.project.id, taskId: f.task.id, agentId: agent.data.id, purpose: "implementation", expectedTaskVersion: 1 });
    await producer(server, `/runs/${runId}/events`, { schemaVersion: 1, eventId: randomUUID(), runId, sequence: 1, type: "run.started", occurredAt: new Date().toISOString(), payload: {} });
    await producer(server, `/runs/${runId}/events`, { schemaVersion: 1, eventId: randomUUID(), runId, sequence: 2, type: "run.heartbeat", occurredAt: new Date().toISOString(), payload: {} });
    await producer(server, `/runs/${runId}/events`, { schemaVersion: 1, eventId: randomUUID(), runId, sequence: 3, type: "run.succeeded", occurredAt: new Date().toISOString(), payload: { summary: "Real stored synthetic evidence", evidenceUrl: "https://example.com/synthetic-p05" } });
    await page.goto(server.url + `/activity?taskId=${f.task.id}`);
    await expect(page.getByText("Real stored synthetic evidence", { exact: true })).toBeVisible();
    await expect(page.locator(".activity-list")).not.toContainText("heartbeat");
    await page.getByRole("link", { name: "Reported succeeded", exact: true }).click();
    await expect(page.getByText("2 · run.heartbeat", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open reported evidence" }).first()).toHaveAttribute("href", "https://example.com/synthetic-p05");
    await page.goto(server.url + `/agents/${agent.data.id.toUpperCase()}`);
    await expect(page.getByRole("heading", { name: "Synthetic history producer", exact: true })).toBeVisible();
    await page.goto(f.boardUrl);
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await page.getByLabel("Add a comment", { exact: true }).fill("Retained comment note");
    await page.getByLabel("Description", { exact: true }).fill("Draft survives live reports");
    await expect(page.getByRole("button", { name: "implementation · Synthetic history producer", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "implementation · Synthetic history producer", exact: true }).click();
    await expect(page.getByText("2 · run.heartbeat", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Draft survives live reports");
    await expect(page.getByLabel("Add a comment", { exact: true })).toHaveValue("Retained comment note");
  } finally { await server.stop(); }
});

test("stopped backup restore repairs auth in-app without losing mounted drafts or exact retry identities", async ({ page }) => {
  test.setTimeout(45000);
  let server = await launch();
  try {
    const f = await fixture(page, server);
    await page.goto(f.boardUrl);
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await page.getByLabel("Add a comment", { exact: true }).fill("Comment remains through stopped restore");
    await page.getByLabel("Description", { exact: true }).fill("Pre-backup retained command");
    const requests: { body: string; key: string }[] = [];
    let historical: unknown;
    await page.route(`**/api/v1/tasks/${f.task.id}`, async route => {
      if (route.request().method() !== "PATCH") { await route.continue(); return; }
      requests.push({ body: route.request().postData()!, key: route.request().headers()["idempotency-key"] });
      if (requests.length === 1) { const response = await route.fetch(); historical = await response.json(); await route.abort(); } else await route.continue();
    });
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry exact request" })).toBeVisible();
    const dir = server.dir, port = server.port;
    await server.stop();
    const backup = join(dir, "p05-stopped-backup.sqlite");
    copyFileSync(join(dir, "agentflow.sqlite"), backup);
    server = await launch({ dir, port });
    const newer = await fetch(server.url + `/api/v1/tasks/${f.task.id}`, { method: "PATCH", headers: { Authorization: "Bearer " + server.credentials().reporterToken, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify({ expectedVersion: 2, description: "Later discarded update" }) });
    expect(newer.status).toBe(200);
    await server.stop(); await restore(dir, backup); server = await launch({ dir, port });
    await expect(page.getByRole("heading", { name: "Pair again to keep editing" })).toBeVisible({ timeout: 20000 });
    await page.getByLabel("Pairing token", { exact: true }).fill(server.credentials().pairingToken);
    await page.getByRole("button", { name: "Pair this browser", exact: true }).click();
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Pre-backup retained command");
    await expect(page.getByLabel("Add a comment", { exact: true })).toHaveValue("Comment remains through stopped restore");
    await expect(page.getByText("Connected updates", { exact: true })).toBeVisible({ timeout: 15000 });
    const cookie = (await page.context().cookies()).find(c => c.name === "agentflow_session")!;
    const replay = await fetch(server.url + `/api/v1/tasks/${f.task.id}`, { method: "PATCH", headers: { Cookie: `${cookie.name}=${cookie.value}`, Origin: server.url, "Content-Type": "application/json", "Idempotency-Key": requests[0].key }, body: requests[0].body });
    expect(replay.status).toBe(200);
    const oldBody = await replay.json();
    expect(oldBody).toEqual(historical);
    expect(replay.headers.get("AgentFlow-Generation")).not.toBe(oldBody.generation);
    await page.getByRole("button", { name: "Retry exact request", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible();
    expect(requests[1]).toEqual(requests[0]);
    await expect(page.getByLabel("Add a comment", { exact: true })).toHaveValue("Comment remains through stopped restore");
  } finally { await page.unrouteAll({ behavior: "ignoreErrors" }); await page.close(); await server.stop(); }
});

test("local-day metrics roll over on the healthy visible tick and focus refreshes immediately", async ({ page }) => {
  test.setTimeout(35000);
  const server = await launch({ entry: "tests/fixtures/p05-clock-runtime.ts", stdin: true });
  try {
    const f = await fixture(page, server);
    const initialSettings = await page.evaluate(async () => (await (await fetch("/api/v1/settings")).json()).data);
    await command(page, "/settings", { expectedVersion: initialSettings.version, timezone: "UTC" }, "PATCH");
    await command(page, `/tasks/${f.task.id}`, { expectedVersion: 1, status: "review" }, "PATCH");
    await command(page, `/tasks/${f.task.id}/complete`, { expectedVersion: 2, evidenceNote: "Synthetic day-boundary fixture" });
    await page.goto(server.url);
    const completed = page.locator(".metrics > div").filter({ hasText: "Completed today" }).locator("dd");
    await expect(completed).toHaveText("1");
    await expect(page.getByText("Connected updates", { exact: true })).toBeVisible();
    server.child.stdin!.write("2026-10-11T00:00:01.000Z\n");
    await expect(completed).toHaveText("0", { timeout: 20000 });
    const settings = await page.evaluate(async () => (await (await fetch("/api/v1/settings")).json()).data);
    await command(page, "/settings", { expectedVersion: settings.version, timezone: "America/Los_Angeles" }, "PATCH");
    await expect(completed).toHaveText("1");
    server.child.stdin!.write("2026-10-11T08:00:01.000Z\n");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(completed).toHaveText("0", { timeout: 3000 });
    await expect(page.getByText("Connected updates", { exact: true })).toBeVisible();
  } finally { await page.close(); await server.stop(); }
});

test("latest stale attempt closure reason and frozen retry survive an actual restored generation", async ({ page }) => {
  test.setTimeout(40000);
  let server = await launch();
  try {
    const f = await fixture(page, server);
    const agent = await producer(server, "/agents", { displayName: "Synthetic restored close producer", source: "public HTTP", defaultRole: "implementation" });
    const runId = randomUUID();
    await producer(server, "/runs", { id: runId, projectId: f.project.id, taskId: f.task.id, agentId: agent.data.id, purpose: "implementation", expectedTaskVersion: 1 });
    await producer(server, `/runs/${runId}/events`, { schemaVersion: 1, eventId: randomUUID(), runId, sequence: 1, type: "run.started", occurredAt: new Date().toISOString(), payload: {} });
    const dir = server.dir, port = server.port;
    await server.stop();
    const db = new Database(join(dir, "agentflow.sqlite"));
    db.prepare("UPDATE runs SET last_received_at=? WHERE id=?").run(Date.now() - 120000, runId); db.close();
    const backup = join(dir, "p05-stale-editor-backup.sqlite");
    copyFileSync(join(dir, "agentflow.sqlite"), backup);
    server = await launch({ dir, port });
    await page.goto(f.boardUrl);
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await page.getByLabel("Add a comment", { exact: true }).fill("Task note stays through close recovery");
    await page.getByRole("button", { name: "implementation · Synthetic restored close producer", exact: true }).click();
    await page.getByRole("button", { name: "Close stale tracking", exact: true }).click();
    await page.getByLabel("Reason", { exact: true }).fill("Reason and exact close identity survive restore");
    const requests: { body: string; key: string }[] = [];
    await page.route(`**/api/v1/runs/${runId}/close`, async route => {
      requests.push({ body: route.request().postData()!, key: route.request().headers()["idempotency-key"] });
      if (requests.length === 1) { await route.fetch(); await route.abort(); } else await route.continue();
    });
    await page.getByRole("button", { name: "Confirm tracking closure", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry exact closure", exact: true })).toBeVisible();
    await server.stop(); await restore(dir, backup); server = await launch({ dir, port });
    await expect(page.getByRole("heading", { name: "Pair again to keep editing" })).toBeVisible({ timeout: 20000 });
    await page.getByLabel("Pairing token", { exact: true }).fill(server.credentials().pairingToken);
    await page.getByRole("button", { name: "Pair this browser", exact: true }).click();
    await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("Reason and exact close identity survive restore");
    await expect(page.getByRole("button", { name: "Retry exact closure", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Retry exact closure", exact: true }).click();
    await expect(page.getByText("Tracking record closed. No process signal was sent.", { exact: true })).toBeVisible();
    expect(requests[1]).toEqual(requests[0]);
    await expect(page.getByLabel("Add a comment", { exact: true })).toHaveValue("Task note stays through close recovery");
  } finally { await page.unrouteAll({ behavior: "ignoreErrors" }); await page.close(); await server.stop(); }
});
