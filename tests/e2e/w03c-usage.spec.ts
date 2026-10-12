import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { launch } from "../fixtures/server";
import { pairPage, command } from "../fixtures/p03";

test.use({ actionTimeout: 10000, navigationTimeout: 15000 });
const proof = process.env.W03C_TASK4_PROOF_DIR;
async function fixture(page: Page, name: string, count = 3) {
  const root = mkdtempSync(join(process.env.W03C_TASK4_DATA_DIR ?? tmpdir(), "usage-ui-"));
  chmodSync(root, 0o700);
  const stat = lstatSync(root), data = join(root, "data"); mkdirSync(data, { mode: 0o700 });
  const streams: { stdout: Buffer[]; stderr: Buffer[]; pid?: number; argv?: string[] } = { stdout: [], stderr: [] };
  let closed!: Promise<void>;
  const server = await launch({ dir: data, bounds: { startupMs: 30000, healthMs: 2000, terminateMs: 10000, killMs: 5000 }, onChild(child) {
    streams.pid = child.pid; streams.argv = child.spawnargs;
    child.stdout!.on("data", part => streams.stdout.push(Buffer.from(part)));
    child.stderr!.on("data", part => streams.stderr.push(Buffer.from(part)));
    closed = new Promise(resolve => child.once("close", () => resolve()));
  } });
  const requests: unknown[] = [], browserRequests: unknown[] = [], sequences = new Map<string, number>();
  page.on("request", r => { if (r.url().includes("/api/v1/usage")) browserRequests.push({ method: r.method(), url: r.url(), key: r.headers()["idempotency-key"], body: r.postData() }); });
  await pairPage(page, server);
  const project = await command(page, "/projects", { name: "Synthetic usage project" }); expect(project.status).toBe(201);
  const projectId = project.body.data.id as string;
  async function report(path: string, body: unknown) {
    const response = await fetch(server.url + "/api/v1" + path, { method: "POST", headers: { Authorization: "Bearer " + server.credentials().reporterToken, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify(body) });
    const value = await response.json(); requests.push({ path, body, status: response.status, generation: response.headers.get("AgentFlow-Generation"), value });
    expect(response.status).toBeLessThan(300); return value.data;
  }
  const agent = await report("/agents", { displayName: "Synthetic usage producer", source: "external fixture", defaultRole: "orchestrator" });
  const runs: string[] = [];
  async function event(runId: string, type: string, payload: unknown) {
    const sequence = (sequences.get(runId) ?? 0) + 1;
    await report(`/runs/${runId}/events`, { schemaVersion: 1, eventId: randomUUID(), runId, sequence, occurredAt: new Date().toISOString(), type, payload }); sequences.set(runId, sequence);
  }
  for (let i = 0; i < count; i++) {
    const runId = randomUUID(); await report("/runs", { id: runId, projectId, agentId: agent.id, purpose: "planning" }); await event(runId, "run.started", {}); runs.push(runId);
  }
  const measuredAt = "2026-01-01T00:00:00.000Z";
  const usage = (usageId: string, inputTokens: number | null, outputTokens: number | null, extra = {}) => ({ usageId, source: "fixture", model: "model", measuredAt, inputTokens, outputTokens, billingBasis: "input_output_only", ...extra });
  const from = new Date(Date.now() - 86400000).toISOString(), to = new Date(Date.now() + 86400000).toISOString();
  async function open() {
    await page.goto(server.url + "/usage");
    await expect(page.getByRole("heading", { name: "Reported usage", exact: true })).toBeVisible();
    await page.getByLabel("Project", { exact: true }).selectOption(projectId);
    await page.getByLabel("From UTC", { exact: true }).fill(from); await page.getByLabel("To UTC", { exact: true }).fill(to);
    await page.getByRole("button", { name: "Apply usage filters", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Reporting coverage", exact: true })).toBeVisible();
  }
  async function finish(extra: unknown = null) {
    await server.stop(); await closed;
    if (proof) writeFileSync(join(proof, name + "-" + randomUUID() + ".json"), JSON.stringify({ name, root, identity: { uid: stat.uid, dev: stat.dev, inode: stat.ino, mode: stat.mode & 0o777 }, projectId, runs, from, to, requests, browserRequests, extra, service: { pid: streams.pid, argv: streams.argv, cwd: process.cwd(), exit: server.child.exitCode, signal: server.child.signalCode, stdoutBase64: Buffer.concat(streams.stdout).toString("base64"), stderrBase64: Buffer.concat(streams.stderr).toString("base64"), stdioClosed: server.child.stdio.every(s => !s || typeof s === "number" || s.destroyed) } }, null, 2), { mode: 0o600 });
  }
  return { server, projectId, runs, event, usage, open, finish, from, to, browserRequests };
}

test("coverage_and_unknowns_are_visible", async ({ page }) => {
  const f = await fixture(page, "coverage");
  try {
    await f.event(f.runs[0], "run.usage", f.usage("complete", 9007199254740991, 7));
    await f.event(f.runs[1], "run.usage", f.usage("partial", null, 0)); await f.open();
    await expect(page.getByText("2 of 3 eligible runs reported usage", { exact: true })).toBeVisible();
    await expect(page.getByText("1 run without reports. Usage is unknown.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("usage-totals")).toContainText("9,007,199,254,740,991");
    await expect(page.getByTestId("usage-totals")).toContainText("9,007,199,254,740,998");
    await expect(page.getByTestId("usage-totals")).toContainText("1 report has unknown total tokens");
    await expect(page.getByText("No matching reports. Usage is unknown.", { exact: true })).toBeVisible();
    await expect(page.getByText(/Producer measurement UTC: 2026-01-01/).first()).toBeVisible();
    await page.getByLabel("Reported source", { exact: true }).fill("unreported source"); await page.getByRole("button", { name: "Apply usage filters" }).click();
    await expect(page.getByText("2 of 3 eligible runs reported usage", { exact: true })).toBeVisible();
    await expect(page.getByTestId("usage-totals")).toContainText("No reports match these filters");
  } finally { await f.finish(); }
});

test("named_estimate_discloses_scope_and_exclusions", async ({ page }) => {
  const f = await fixture(page, "estimate", 1);
  try {
    await f.event(f.runs[0], "run.usage", f.usage("complete", 1000000, 2000000));
    await f.event(f.runs[0], "run.usage", f.usage("unknown", null, 7));
    await f.event(f.runs[0], "run.usage", f.usage("null-basis", 3, 7, { billingBasis: null }));
    await f.event(f.runs[0], "run.usage", f.usage("unsupported", 3, 7, { billingBasis: "unrepresented" }));
    await f.event(f.runs[0], "run.usage", f.usage("missing", 3, 7, { model: "other" })); await f.open();
    await page.getByLabel("Snapshot name", { exact: true }).fill("Synthetic local rates");
    await page.getByLabel("Captured UTC", { exact: true }).fill(new Date().toISOString());
    await page.getByLabel("Price source 1", { exact: true }).fill("fixture"); await page.getByLabel("Price model 1", { exact: true }).fill("model");
    await page.getByLabel("Input price per million 1", { exact: true }).fill("0.000000000001"); await page.getByLabel("Output price per million 1", { exact: true }).fill("2.5");
    await page.getByRole("button", { name: "Save immutable price snapshot", exact: true }).click();
    await expect(page.getByText("Price snapshot saved. Select it explicitly to estimate.", { exact: true })).toBeVisible();
    await page.getByLabel("Price snapshot", { exact: true }).selectOption({ label: "Synthetic local rates" });
    await expect(page.getByRole("heading", { name: "Local estimate", exact: true })).toBeVisible();
    await expect(page.getByText("USD 5.000000000001", { exact: true })).toBeVisible();
    await expect(page.getByText("1 included report · 1 unknown counts · 2 unsupported billing basis · 1 missing or partial price", { exact: true })).toBeVisible();
    await expect(page.getByText("Estimate only. This is not a bill.", { exact: true })).toBeVisible();
  } finally { await f.finish(); }
});

test("generation_resets_pages_preserves_drafts", async ({ page, browser }) => {
  const f = await fixture(page, "generation", 52), other = await browser.newContext(), second = await other.newPage();
  try {
    await pairPage(second, f.server); await f.open();
    await page.getByLabel("Snapshot name", { exact: true }).fill("Frozen synthetic draft");
    await page.getByLabel("Captured UTC", { exact: true }).fill(new Date().toISOString());
    await page.getByLabel("Price source 1", { exact: true }).fill("fixture"); await page.getByLabel("Price model 1", { exact: true }).fill("model");
    await page.getByLabel("Reported model", { exact: true }).fill("unsaved model");
    await expect(page.getByText("Showing 50 of 52 eligible runs", { exact: true })).toBeVisible();
    await page.route("**/api/v1/updates?**", route => route.abort());
    await command(second, "/projects", { name: "Synthetic high-water change" });
    await page.getByRole("button", { name: "Load more eligible runs", exact: true }).click();
    await expect(page.getByText(/History changed. Pages were reset/)).toBeVisible();
    await expect(page.getByLabel("Reported model", { exact: true })).toHaveValue("unsaved model");
    let lost = true;
    await page.route("**/api/v1/usage/price-snapshots", async route => {
      if (route.request().method() !== "POST" || !lost) return route.continue();
      lost = false; await route.fetch(); await route.abort("failed");
    });
    await page.getByRole("button", { name: "Save immutable price snapshot", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry exact price request", exact: true })).toBeVisible();
    const preview = await command(second, "/retention/preview", { cutoff: new Date(Date.now() - 1).toISOString() }); expect(preview.status).toBe(200);
    const p = preview.body.data; const prune = await command(second, "/retention/prune", { previewId: p.previewId, expectedGeneration: p.expectedGeneration, expectedVersion: p.expectedVersion, candidateDigest: p.candidateDigest }); expect(prune.status).toBe(200);
    await page.getByRole("button", { name: "Retry exact price request", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry exact price request", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Retry exact price request", exact: true }).click();
    await expect(page.getByText("Price snapshot saved. Select it explicitly to estimate.", { exact: true })).toBeVisible();
    const posts = f.browserRequests.filter((x): x is { method: string; body: string; key: string } => (x as {method:string}).method === "POST"); expect(posts).toHaveLength(3); expect(posts[1]).toEqual(posts[0]); expect(posts[2]).toEqual(posts[0]);
    await expect(page.getByLabel("Reported model", { exact: true })).toHaveValue("unsaved model");
    await second.goto(f.server.url + "/usage"); await expect(second.getByLabel("Price snapshot", { exact: true })).toContainText("Frozen synthetic draft");
    await expect(page.getByLabel("Price snapshot", { exact: true })).toContainText("Frozen synthetic draft");
  } finally { await other.close(); await f.finish(); }
});

test("usage_event_tracking_is_honest", async ({ page }) => {
  const f = await fixture(page, "tracking", 1);
  try {
    await f.event(f.runs[0], "run.usage", f.usage("partial", null, 7));
    await page.goto(f.server.url + "/activity"); await expect(page.getByText("Reported token usage · input Unknown · output 7", { exact: true }).first()).toBeVisible();
    await page.goto(f.server.url + "/runs/" + f.runs[0]); await expect(page.getByText("Reported token usage · input Unknown · output 7", { exact: true }).first()).toBeVisible();
  } finally { await f.finish(); }
});

 test("usage appearance batch", async ({ page }) => {
  test.skip(!process.env.W03C_TASK4_APPEARANCE, "Appearance is a single explicitly released batch.");
  const f = await fixture(page, "appearance", 3);
  try {
    await f.event(f.runs[0], "run.usage", f.usage("complete", 12345, 67)); await f.event(f.runs[1], "run.usage", f.usage("partial", null, 7)); await f.open();
    await page.emulateMedia({ reducedMotion: "reduce" });
    const captures: unknown[] = [];
    for (const [name, width, height] of [["desktop",1440,1000],["narrow",375,812]] as const) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => scrollTo(0,0));
      const result = await new AxeBuilder({ page }).include("#main-content").analyze(); expect(result.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByLabel("From UTC", { exact: true }).focus(); await expect(page.getByLabel("From UTC", { exact: true })).toBeFocused();
      const path = join(proof!, name + "-" + process.env.W03C_TASK4_APPEARANCE + ".png"); await page.screenshot({ path, fullPage: true, animations: "disabled" });
      captures.push({ name,width,height,path,axe:result.violations,metrics:await page.evaluate(() => ({ innerWidth, dpr:devicePixelRatio, cssZoom:getComputedStyle(document.body).zoom, motion:matchMedia("(prefers-reduced-motion: reduce)").matches })) });
    }
    await f.finish({ captures });
  } finally { if (f.server.child.exitCode === null) await f.finish(); }
});
