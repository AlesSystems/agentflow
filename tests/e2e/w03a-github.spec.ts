import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, chromium, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { githubBrowserFixture } from "../fixtures/w03a-browser";
import { pairPage, command } from "../fixtures/p03";
const proof = process.env.AGENTFLOW_W03A_UI_EVIDENCE;
async function configure(page: Page) {
  await page.getByLabel("Enable read-only GitHub observations", { exact: true }).check();
  await page.getByLabel("Selected repositories", { exact: true }).fill("a/b");
  await page.getByRole("button", { name: "Save GitHub selection", exact: true }).click();
  await expect(page.getByText("GitHub selection saved.", { exact: true })).toBeVisible();
}
async function capture(page: Page, name: string) {
  if (!proof) return;
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: join(proof, name + ".png"), fullPage: true, animations: "disabled" });
}

test("two paired tabs preserve GitHub intents and exact retries while local reads never fetch remotely", async ({ page, browser }) => {
  test.setTimeout(60000);
  const fixture = await githubBrowserFixture(), { server, state, wires } = fixture;
  const other = await browser.newContext(), second = await other.newPage();
  const requests: { key: string | undefined; body: string | null }[] = [];
  try {
    await pairPage(page, server); await pairPage(second, server);
    await page.goto(server.url + "/settings"); await second.goto(server.url + "/settings");
    await expect(page.getByRole("heading", { name: "GitHub PR observations", exact: true })).toBeVisible();
    expect(wires).toHaveLength(0);
    await configure(page);
    await expect(second.getByText("Observations enabled", { exact: false })).toBeVisible();
    await second.getByLabel("Selected repositories", { exact: true }).fill("a/b\nc/d");
    await command(page, "/connections/github/repositories", { expectedVersion: 2, enabled: true, repositories: ["a/b", "e/f"] }, "PUT");
    await second.getByRole("button", { name: "Save GitHub selection", exact: true }).click();
    await expect(second.getByText(/GitHub configuration changed or this request conflicts/)).toBeVisible();
    await expect(second.getByLabel("Selected repositories", { exact: true })).toHaveValue("a/b\nc/d");
    await second.getByRole("button", { name: "Refresh locally and prepare new request", exact: true }).click();
    await expect(second.getByText(/Prepared against current GitHub version 3/)).toBeVisible();
    await expect(second.getByText("Current saved repositories: a/b, e/f", { exact: true })).toBeVisible();
    await second.getByRole("button", { name: "Save GitHub selection", exact: true }).click();
    await expect(page.getByText("Current saved repositories: a/b, c/d", { exact: true })).toBeVisible();
    expect(wires).toHaveLength(0);
    page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/connections/github/refresh")) requests.push({ key: r.headers()["idempotency-key"], body: r.postData() }); });
    await page.route("**/api/v1/connections/github/refresh", async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200);
      await route.abort("failed"); await page.unroute("**/api/v1/connections/github/refresh");
    });
    await page.getByRole("button", { name: "Fetch GitHub metadata", exact: true }).click();
    await expect(page.getByText(/Response is uncertain/)).toBeVisible();
    await page.getByRole("button", { name: "Retry exact GitHub request", exact: true }).click();
    await expect(page.getByText("Synthetic private PR", { exact: true })).toBeVisible();
    expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]); expect(wires).toHaveLength(1);
    await page.getByRole("button", { name: "Refresh local GitHub cache", exact: true }).click();
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
    await command(second, "/projects", { name: "Synthetic SSE invalidation" });
    await expect(second.getByText("Synthetic private PR", { exact: true })).toBeVisible();
    expect(wires).toHaveLength(1);
    const project = await command(page, "/projects", { name: "Synthetic linked task" });
    const task = await command(page, "/tasks", { projectId: project.body.data.id, title: "Synthetic accepted PR task", pullRequestUrl: "https://github.com/a/b/pull/9" });
    const id = task.body.data.id;
    await command(page, `/tasks/${id}`, { expectedVersion: 1, status: "review" }, "PATCH");
    await command(page, `/tasks/${id}/complete`, { expectedVersion: 2, evidenceNote: "Synthetic browser-role acceptance" });
    const readTask = () => page.evaluate(async id => (await (await fetch(`/api/v1/tasks/${id}`)).json()).data, id);
    const before = await readTask();
    state.head = "b".repeat(40); state.draft = true;
    await page.getByRole("combobox", { name: "Fetch target", exact: true }).selectOption("number");
    await page.getByLabel("PR number", { exact: true }).fill("9");
    await page.getByRole("button", { name: "Fetch GitHub metadata", exact: true }).click();
    await expect(page.getByText(/Observed PR head changed/)).toBeVisible();
    expect(await readTask()).toEqual(before); expect(wires).toHaveLength(2);
    const denied = await fetch(server.url + "/api/v1/connections/github?repository=a%2Fb&number=9", { headers: { Authorization: "Bearer " + server.credentials().reporterToken } });
    expect(denied.status).toBe(403); expect(await denied.text()).not.toContain("Synthetic private PR");
    expect(wires.every(w => w.method === "GET" && w.version === "2026-03-10")).toBe(true);
    state.status = 401;
    await page.getByRole("button", { name: "Fetch GitHub metadata", exact: true }).click();
    await expect(page.getByText(/GitHub rejected authentication/).first()).toBeVisible();
    await expect(page.getByText("Synthetic private PR", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Disconnect GitHub", exact: true }).click();
    await expect(page.getByText("Disconnected · stale observation", { exact: true })).toBeVisible();
    await capture(page, "settings-desktop");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 375, height: 812 }); await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await capture(page, "settings-narrow");
    await page.goto(server.url + `/projects/${project.body.data.id}/tasks/${id}`);
    await expect(page.getByRole("heading", { name: "Pull request observation", exact: true })).toBeVisible();
    await expect(page.getByText("Synthetic private PR", { exact: true })).toBeVisible();
    await expect(page.getByText("Human accepted", { exact: true }).first()).toBeVisible();
    expect(await readTask()).toEqual(before);
    await capture(page, "task-narrow");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload();
    await expect(page.getByText("Synthetic private PR", { exact: true })).toBeVisible();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await capture(page, "task-desktop");
    const callsBeforeOffline = wires.length;
    await second.context().setOffline(true);
    await second.getByRole("button", { name: "Refresh local GitHub cache", exact: true }).click();
    await expect(second.getByText("Local browser is offline. Cached GitHub observations are retained.", { exact: true })).toBeVisible();
    await expect(second.getByText("Synthetic private PR", { exact: true })).toBeVisible();
    await second.context().setOffline(false);
    await page.context().setOffline(true);
    await page.getByRole("button", { name: "Refresh local PR observation", exact: true }).click();
    await expect(page.getByText("Local browser is offline. Cached GitHub observations are retained.", { exact: true })).toBeVisible();
    await expect(page.getByText("Synthetic private PR", { exact: true })).toBeVisible();
    expect(wires).toHaveLength(callsBeforeOffline);
    await page.context().setOffline(false);
    if (proof) writeFileSync(join(proof, "browser-contract.json"), JSON.stringify({ dir: fixture.dir, wires, requests, before, after: await readTask(), scopes: "synthetic fixture only" }, null, 2), { mode: 0o600 });
  } finally { await other.close(); await fixture.stop(); }
});

test("credential repair and unsupported or unselected task URLs remain safe and local", async ({ page }) => {
  const fixture = await githubBrowserFixture(), { server, wires } = fixture;
  try {
    await pairPage(page, server); await page.goto(server.url + "/settings"); await configure(page);
    writeFileSync(fixture.credential, "invalid synthetic JSON", { mode: 0o600 });
    await page.getByRole("button", { name: "Fetch GitHub metadata", exact: true }).click();
    await expect(page.getByText(/Local credential needs repair/).first()).toBeVisible();
    expect(wires).toHaveLength(0);
    const p = await command(page, "/projects", { name: "Synthetic inert links" });
    for (const [url, message] of [["https://example.com/a/pull/9", "This URL is unsupported for GitHub observation. No metadata is fetched."], ["https://github.com/unselected/repo/pull/9", "This repository is not selected."]]) {
      const t = await command(page, "/tasks", { projectId: p.body.data.id, title: "Inert URL", pullRequestUrl: url });
      await page.goto(server.url + `/projects/${p.body.data.id}/tasks/${t.body.data.id}`);
      await expect(page.getByText(message, { exact: false })).toBeVisible();
      expect(await page.locator(`a[href="${url}"]`).count()).toBe(0);
    }
    expect(wires).toHaveLength(0);
  } finally { await fixture.stop(); }
});

test("native Chrome 200 percent zoom and keyboard retain readable GitHub controls", async () => {
  test.setTimeout(60000);
  const fixture = await githubBrowserFixture(), { server } = fixture;
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "w03a-zoom-")), { channel: "chrome", headless: true, viewport: null, args: ["--window-size=1440,1000"] });
  const page = await context.newPage();
  try {
    await pairPage(page, server);
    const before = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio }));
    await page.goto("chrome://settings/appearance"); await page.locator("select#zoomLevel").selectOption("2");
    await page.goto(server.url + "/settings");
    await expect(page.getByRole("heading", { name: "GitHub PR observations", exact: true })).toBeVisible();
    const after = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, cssZoom: getComputedStyle(document.body).zoom }));
    expect(after.width).toBeLessThan(before.width * 0.6); expect(after.dpr).toBeGreaterThan(before.dpr * 1.9); expect(after.cssZoom).toBe("1");
    await page.getByLabel("Enable read-only GitHub observations", { exact: true }).focus(); await page.keyboard.press("Space");
    await expect(page.getByLabel("Enable read-only GitHub observations", { exact: true })).toBeChecked();
    await page.getByLabel("Selected repositories", { exact: true }).fill("a/b");
    await page.getByRole("button", { name: "Save GitHub selection", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByText("GitHub selection saved.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Fetch GitHub metadata", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByText("Synthetic private PR", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const session = await context.newCDPSession(page), metrics = await session.send("Page.getLayoutMetrics");
    await page.getByLabel("Selected repositories", { exact: true }).scrollIntoViewIfNeeded();
    const screenshot = await session.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const bytes = Buffer.from(screenshot.data, "base64");
    expect(bytes.readUInt32BE(16)).toBe(metrics.layoutViewport.clientWidth);
    expect(bytes.readUInt32BE(16)).toBe(Math.round(metrics.cssLayoutViewport.clientWidth * after.dpr));
    const bounds = await page.getByLabel("Selected repositories", { exact: true }).boundingBox(); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(after.width);
    if (proof) { writeFileSync(join(proof, "settings-native-200-unclipped.png"), bytes); writeFileSync(join(proof, "native-zoom.json"), JSON.stringify({ before, after, metrics, bounds, captureWidth: bytes.readUInt32BE(16), captureHeight: bytes.readUInt32BE(20) }, null, 2), { mode: 0o600 }); }
    const project = await command(page, "/projects", { name: "Synthetic native PR zoom" });
    const task = await command(page, "/tasks", { projectId: project.body.data.id, title: "Native PR observation", pullRequestUrl: "https://github.com/a/b/pull/9" });
    await page.goto(server.url + `/projects/${project.body.data.id}/tasks/${task.body.data.id}`);
    await expect(page.getByText("Synthetic private PR", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Refresh local PR observation", exact: true }).focus(); await page.keyboard.press("Enter");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const prBounds = await page.locator(".task-github").boundingBox(); expect(prBounds!.x + prBounds!.width).toBeLessThanOrEqual(after.width);
    await page.locator(".task-github").scrollIntoViewIfNeeded();
    if (proof) { const prCapture = await session.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false }); writeFileSync(join(proof, "task-native-200-pr-unclipped.png"), Buffer.from(prCapture.data, "base64")); }
    await session.detach();
  } finally { await context.close(); await fixture.stop(); }
});


test("historical configuration replies converge and a busy key retries without consumption", async ({ page, browser }) => {
  test.setTimeout(60000);
  const fixture = await githubBrowserFixture(), { server, state, wires } = fixture;
  const other = await browser.newContext(), second = await other.newPage();
  const requests: { key: string | undefined; body: string | null }[] = [];
  try {
    await pairPage(page, server); await pairPage(second, server);
    await page.goto(server.url + "/settings"); await configure(page);
    await second.goto(server.url + "/settings");
    page.on("request", r => { if (r.method() === "PUT" && r.url().endsWith("/connections/github/repositories")) requests.push({ key: r.headers()["idempotency-key"], body: r.postData() }); });
    await page.getByLabel("Selected repositories", { exact: true }).fill("a/b\nc/d");
    await page.route("**/api/v1/connections/github/repositories", async route => {
      const reply = await route.fetch(); expect(reply.status()).toBe(200);
      await route.abort("failed"); await page.unroute("**/api/v1/connections/github/repositories");
    });
    await page.getByRole("button", { name: "Save GitHub selection", exact: true }).click();
    await expect(page.getByText(/Response is uncertain/)).toBeVisible();
    await command(second, "/connections/github/repositories", { expectedVersion: 3, enabled: true, repositories: ["a/b", "e/f"] }, "PUT");
    await page.getByRole("button", { name: "Retry exact GitHub request", exact: true }).click();
    await expect(page.getByLabel("Selected repositories", { exact: true })).toHaveValue("a/b\ne/f");
    expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]); expect(wires).toHaveLength(0);
    await second.getByRole("button", { name: "Refresh local GitHub cache", exact: true }).click();
    state.hold = true;
    await page.getByRole("button", { name: "Fetch GitHub metadata", exact: true }).click();
    await fixture.arrival();
    const busyRequests: { key: string | undefined; body: string | null }[] = [];
    second.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/connections/github/refresh")) busyRequests.push({ key: r.headers()["idempotency-key"], body: r.postData() }); });
    await second.getByLabel("List page", { exact: true }).fill("2");
    await second.getByRole("button", { name: "Fetch GitHub metadata", exact: true }).click();
    await expect(second.getByText(/Another GitHub request is busy/)).toBeVisible();
    expect(wires).toHaveLength(1);
    fixture.release();
    await expect(page.getByText("Synthetic private PR", { exact: true })).toBeVisible();
    await second.getByRole("button", { name: "Retry exact GitHub request", exact: true }).click();
    await expect(second.getByText(/Observation request recorded/)).toBeVisible();
    expect(busyRequests).toHaveLength(2); expect(busyRequests[0]).toEqual(busyRequests[1]); expect(wires).toHaveLength(2);
    state.status = 429;
    await page.getByRole("button", { name: "Fetch GitHub metadata", exact: true }).click();
    await expect(page.getByText(/GitHub rate limited this connection/).first()).toBeVisible();
    await expect(page.getByText(/GitHub retry not before/)).toBeVisible();
    await expect(page.getByText("Synthetic private PR", { exact: true })).toBeVisible();
    const rateCalls = wires.length;
    await page.getByRole("button", { name: "Fetch GitHub metadata", exact: true }).click();
    await expect(page.getByText(/GitHub configuration changed or this request conflicts/)).toBeVisible();
    expect(wires).toHaveLength(rateCalls);
    await page.getByRole("button", { name: "Refresh locally and prepare new request", exact: true }).click();
    await page.getByRole("button", { name: "Save GitHub selection", exact: true }).click();
    await expect(page.getByText("GitHub selection saved.", { exact: true })).toBeVisible();
    await expect(page.getByText(/GitHub retry not before/)).toBeVisible();
    await page.getByRole("button", { name: "Fetch GitHub metadata", exact: true }).click();
    await expect(page.getByText(/GitHub configuration changed or this request conflicts/)).toBeVisible();
    expect(wires).toHaveLength(rateCalls);
    if (proof) writeFileSync(join(proof, "historical-busy-rate.json"), JSON.stringify({ requests, busyRequests, wires }, null, 2), { mode: 0o600 });
  } finally { fixture.release(); await other.close(); await fixture.stop(); }
});
