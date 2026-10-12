import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, expect, chromium, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { launch } from "../fixtures/server";
import { pairPage, command } from "../fixtures/p03";

test.use({ actionTimeout: 10000, navigationTimeout: 15000 });
const proof = process.env.W03C_TASK4_PROOF_DIR;
async function fixture(page: Page, name: string, count = 3) {
  const root = mkdtempSync(join(process.env.W03C_TASK4_DATA_DIR ?? tmpdir(), "usage-ui-"));
  chmodSync(root, 0o700);
  const stat = lstatSync(root), data = join(root, "data"); mkdirSync(data, { mode: 0o700 });
  let streams: { stdout: Buffer[]; stderr: Buffer[]; pid?: number; argv?: string[] } = { stdout: [], stderr: [] };
  let closed!: Promise<void>;
  const services: unknown[] = [], commands: unknown[] = [];
  const launchOptions = { dir: data, bounds: { startupMs: 30000, healthMs: 2000, terminateMs: 10000, killMs: 5000 }, onChild(child: import("node:child_process").ChildProcess) {
    streams.pid = child.pid; streams.argv = child.spawnargs;
    child.stdout!.on("data", part => streams.stdout.push(Buffer.from(part)));
    child.stderr!.on("data", part => streams.stderr.push(Buffer.from(part)));
    closed = new Promise(resolve => child.once("close", () => resolve()));
  } };
  let server = await launch(launchOptions);
  async function stop() {
    await server.stop(); await closed; services.push({ pid:streams.pid, argv:streams.argv, cwd:process.cwd(), exit:server.child.exitCode, signal:server.child.signalCode, stdoutBase64:Buffer.concat(streams.stdout).toString("base64"),stderrBase64:Buffer.concat(streams.stderr).toString("base64"),stdioClosed:server.child.stdio.every(s => !s || typeof s === "number" || s.destroyed) });
  }
  async function restored() {
    const port=server.port; await stop(); const backup=join(root,"before-restore.sqlite");
    for (const args of [["backup","--output",backup],["restore","--from",backup]]) {
      const argv=["--import","tsx","src/cli/local.ts",...args],env={...process.env,AGENTFLOW_DATA_DIR:data};
      const result=spawnSync(process.execPath,argv,{cwd:process.cwd(),env,timeout:20000}); commands.push({argv:[process.execPath,...argv],cwd:process.cwd(),data,exit:result.status,signal:result.signal,stdoutBase64:result.stdout?.toString("base64"),stderrBase64:result.stderr?.toString("base64")}); expect(result.status).toBe(0);
    }
    streams={stdout:[],stderr:[]};server=await launch({...launchOptions,port});
  }
  const requests: unknown[] = [], browserRequests: unknown[] = [], responses: unknown[] = [], sequences = new Map<string, number>();
  page.on("request", r => { if (r.url().includes("/api/v1/usage")) browserRequests.push({ method: r.method(), url: r.url(), key: r.headers()["idempotency-key"], body: r.postData() }); });
  page.on("response", async r => { if (r.url().includes("/api/v1/usage")) { try { responses.push({ url:r.url(), status:r.status(), generation:r.headers()["agentflow-generation"], body:await r.json() }); } catch {} } });
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
    await page.getByRole("combobox", { name: "Project", exact: true }).selectOption(projectId);
    await page.getByLabel("From UTC", { exact: true }).fill(from); await page.getByLabel("To UTC", { exact: true }).fill(to);
    await page.getByRole("button", { name: "Apply usage filters", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Reporting coverage", exact: true })).toBeVisible();
  }
  async function read(path:string) { const result=await page.evaluate(async path=>{const r=await fetch("/api/v1"+path);return {status:r.status,body:await r.json(),generation:r.headers.get("AgentFlow-Generation")};},path);requests.push({method:"GET",path,...result});return result; }
  async function finish(extra: unknown = null) {
    await stop();
    if (proof) writeFileSync(join(proof, name + "-" + randomUUID() + ".json"), JSON.stringify({ name, root, identity: { uid: stat.uid, dev: stat.dev, inode: stat.ino, mode: stat.mode & 0o777 }, projectId, runs, from, to, requests, browserRequests, responses, extra, services, commands }, null, 2), { mode: 0o600 });
  }
  return { get server() { return server; }, restored, read, projectId, runs, event, usage, open, finish, from, to, browserRequests };
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
    await page.getByRole("combobox", { name: "Price snapshot", exact: true }).selectOption({ label: "Synthetic local rates" });
    await expect(page.getByRole("heading", { name: "Local estimate", exact: true })).toBeVisible();
    expect(await page.locator("#groups-heading").evaluate(groups => Boolean(groups.compareDocumentPosition(document.querySelector("#estimate-heading")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await expect(page.getByText("USD 5.000000000001", { exact: true })).toBeVisible();
    await expect(page.getByText("1 included report · 1 unknown counts · 2 unsupported billing basis · 1 missing or partial price", { exact: true })).toBeVisible();
    await expect(page.getByText("Estimate only. This is not a bill.", { exact: true })).toBeVisible();
    await page.getByLabel("Snapshot name",{exact:true}).fill("Synthetic partial rates");await page.getByLabel("Output price per million 1",{exact:true}).fill("");await page.getByRole("button",{name:"Save immutable price snapshot",exact:true}).click();await expect(page.getByText("Price snapshot saved. Select it explicitly to estimate.",{exact:true})).toBeVisible();await page.getByRole("combobox",{name:"Price snapshot",exact:true}).selectOption({label:"Synthetic partial rates"});
    await expect(page.getByText("0 included reports · 1 unknown counts · 2 unsupported billing basis · 2 missing or partial price",{exact:true})).toBeVisible();await expect(page.getByText("No reports can be estimated with the selected snapshot.",{exact:true})).toBeVisible();
  } finally { await f.finish(); }
});

test("generation_resets_pages_preserves_drafts", async ({ page, browser }) => {
  const f = await fixture(page, "generation", 52), other = await browser.newContext(), second = await other.newPage();
  try {
    await pairPage(second, f.server); await page.route("**/api/v1/changes/stream?**", route => route.abort()); await f.open();
    await page.getByLabel("Snapshot name", { exact: true }).fill("Frozen synthetic draft");
    await page.getByLabel("Captured UTC", { exact: true }).fill(new Date().toISOString());
    await page.getByLabel("Price source 1", { exact: true }).fill("fixture"); await page.getByLabel("Price model 1", { exact: true }).fill("model");
    await page.getByLabel("Reported model", { exact: true }).fill("unsaved model");
    await expect(page.getByText("Showing 50 of 52 eligible runs", { exact: true })).toBeVisible();
    await command(second, "/projects", { name: "Synthetic high-water change" });
    await page.getByRole("button", { name: "Load more eligible runs", exact: true }).click();
    await expect(page.getByText(/History changed. Pages were reset/)).toBeVisible();
    await expect(page.getByLabel("Reported model", { exact: true })).toHaveValue("unsaved model");
    await page.getByRole("button",{name:"Load more eligible runs",exact:true}).click();await expect(page.getByText("Showing 52 of 52 eligible runs",{exact:true})).toBeVisible();
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
    await second.goto(f.server.url + "/usage"); await expect(second.getByRole("combobox", { name: "Price snapshot", exact: true })).toContainText("Frozen synthetic draft");
    await expect(page.getByRole("combobox", { name: "Price snapshot", exact: true })).toContainText("Frozen synthetic draft");
    await expect(page.getByText("Showing 50 of 52 eligible runs",{exact:true})).toBeVisible();
  } finally { await other.close(); await f.finish(); }
});

test("usage_event_tracking_is_honest", async ({ page }) => {
  const f = await fixture(page, "tracking", 1);
  try {
    await f.event(f.runs[0], "run.usage", f.usage("partial", null, 7));
    const latest=await f.read("/tracking/runs/"+f.runs[0]);expect(latest.status).toBe(200);expect(latest.body.data.message).toBe("Reported token usage · input Unknown · output 7");
    await page.goto(f.server.url + "/activity"); await expect(page.getByText(/^Reported token usage · input Unknown · output 7/).first()).toBeVisible();
    await page.goto(f.server.url + "/runs/" + f.runs[0]); await expect(page.getByText(/^Reported token usage · input Unknown · output 7/).first()).toBeVisible();
  } finally { await f.finish(); }
});

test("usage groups are bounded and overall subtotals include overflow", async ({ page }) => {
  const f = await fixture(page, "groups", 1);
  try {
    for (let i=0;i<101;i++) await f.event(f.runs[0],"run.usage",f.usage("group-"+i,1,1,{model:"synthetic-model-"+String(i).padStart(3,"0")}));
    await f.open(); await expect(page.getByText("Showing 100 of 101 groups. Groups are capped at 100; overall subtotals include every matching report.",{exact:true})).toBeVisible();
    await expect(page.getByTestId("usage-totals")).toContainText("202 tokens from complete reports only");
    await expect(page.getByRole("heading",{name:"synthetic-model-100",exact:true})).toHaveCount(0);
  } finally { await f.finish(); }
});
test("offline and restore retain usage and price drafts through pairing", async ({ page, browser }) => {
  const f = await fixture(page,"restore",1), other=await browser.newContext(), second=await other.newPage();
  try {
    await pairPage(second,f.server); await f.event(f.runs[0],"run.usage",f.usage("initial",3,7)); await f.open();
    await page.getByLabel("Snapshot name",{exact:true}).fill("Retained restore draft"); await page.getByLabel("Reported model",{exact:true}).fill("unsaved model");
    await page.context().setOffline(true); await page.getByRole("button",{name:"Apply usage filters"}).click();
    await expect(page.getByLabel("Snapshot name",{exact:true})).toHaveValue("Retained restore draft"); await page.context().setOffline(false);
    await f.restored(); await page.getByRole("button",{name:"Apply usage filters"}).click();
    const modal=page.getByRole("dialog",{name:"Pair again to keep editing",exact:true}); await expect(modal).toBeVisible();
    await modal.getByLabel("Pairing token",{exact:true}).fill(f.server.credentials().pairingToken); await modal.getByRole("button",{name:"Pair this browser",exact:true}).click(); await expect(modal).toHaveCount(0);
    await expect(page.getByLabel("Snapshot name",{exact:true})).toHaveValue("Retained restore draft"); await expect(page.getByLabel("Reported model",{exact:true})).toHaveValue("unsaved model");
    await page.getByLabel("Reported model",{exact:true}).fill(""); await page.getByRole("button",{name:"Apply usage filters"}).click(); await expect(page.getByText("1 of 1 eligible runs reported usage",{exact:true})).toBeVisible();
    await pairPage(second,f.server); await second.goto(f.server.url+"/usage"); await second.getByRole("combobox",{name:"Project",exact:true}).selectOption(f.projectId); await second.getByLabel("From UTC",{exact:true}).fill(f.from); await second.getByLabel("To UTC",{exact:true}).fill(f.to); await second.getByRole("button",{name:"Apply usage filters"}).click();
    await expect(second.getByTestId("usage-totals")).toContainText("10 tokens from complete reports only"); await expect(page.getByTestId("usage-totals")).toContainText("10 tokens from complete reports only");
    await page.getByLabel("Snapshot name",{exact:true}).focus();await f.event(f.runs[0],"run.usage",f.usage("after-restore",2,3));
    await expect(second.getByTestId("usage-totals")).toContainText("15 tokens from complete reports only");await expect(page.getByTestId("usage-totals")).toContainText("15 tokens from complete reports only");await expect(page.getByLabel("Snapshot name",{exact:true})).toBeFocused();await expect(page.getByLabel("Snapshot name",{exact:true})).toHaveValue("Retained restore draft");
  } finally { await page.context().setOffline(false); await other.close(); await f.finish(); }
});

test("rejected continuation waits for a successful replacement first page", async ({ page, browser }) => {
  const f=await fixture(page,"blocked-continuation",52),other=await browser.newContext(),second=await other.newPage();
  let release:()=>void=()=>{},began:()=>void=()=>{};const started=new Promise<void>(resolve=>{began=resolve});let mode:"held"|"failed"|"healthy"="held";
  try {
    await pairPage(second,f.server);await page.route("**/api/v1/changes/stream?**",route=>route.abort());await f.open();
    await page.getByLabel("Snapshot name",{exact:true}).fill("Retained recovery draft");
    await page.route("**/api/v1/usage?**",async route=>{
      if(new URL(route.request().url()).searchParams.has("cursor")||mode==="healthy")return route.continue();
      const native=await route.fetch();began();if(mode==="held")await new Promise<void>(resolve=>{release=resolve});
      if(mode==="failed")return route.abort("failed");return route.fulfill({response:native});
    });
    await command(second,"/projects",{name:"Synthetic blocked high-water change"});await page.getByRole("button",{name:"Load more eligible runs",exact:true}).click();await started;
    await expect(page.getByRole("button",{name:"Load more eligible runs",exact:true})).toHaveCount(0);
    await expect(page.getByText("Showing 50 of 52 eligible runs",{exact:true})).toBeVisible();await expect(page.getByLabel("Snapshot name",{exact:true})).toHaveValue("Retained recovery draft");
    mode="failed";release();await expect(page.locator(".error").filter({hasText:"Could not refresh this view"})).toBeVisible();
    await expect(page.getByRole("button",{name:"Load more eligible runs",exact:true})).toHaveCount(0);
    const continuations=()=>f.browserRequests.filter(x=>new URL((x as {url:string}).url).searchParams.has("cursor"));expect(continuations()).toHaveLength(1);
    mode="healthy";await page.locator(".error").filter({hasText:"Could not refresh this view"}).getByRole("button",{name:"Retry refresh",exact:true}).click();
    await expect(page.getByRole("button",{name:"Load more eligible runs",exact:true})).toBeVisible();await page.getByRole("button",{name:"Load more eligible runs",exact:true}).click();await expect(page.getByText("Showing 52 of 52 eligible runs",{exact:true})).toBeVisible();
    expect(continuations()).toHaveLength(2);expect((continuations()[1] as {url:string}).url).not.toBe((continuations()[0] as {url:string}).url);
  } finally {release();await page.unroute("**/api/v1/usage?**");await other.close();await f.finish();}
});
test("page-two project and price selections retain their labels across refresh and generation", async ({ page, browser }) => {
  test.setTimeout(60000);const f=await fixture(page,"retained-selection",1),other=await browser.newContext(),second=await other.newPage();
  try {
    await pairPage(second,f.server);await f.event(f.runs[0],"run.usage",f.usage("selection",3,7));
    for(let i=0;i<50;i++)expect((await command(second,"/projects",{name:"Synthetic newer project "+i})).status).toBe(201);
    const priceId=randomUUID();const input=(id:string,name:string)=>({id,name,capturedAt:new Date().toISOString(),entries:[{source:"fixture",model:"model",currency:"USD",inputPrice:"1",outputPrice:"2"}]});
    expect((await command(second,"/usage/price-snapshots",input(priceId,"Synthetic retained older price"))).status).toBe(201);
    for(let i=0;i<50;i++)expect((await command(second,"/usage/price-snapshots",input(randomUUID(),"Synthetic newer price "+i))).status).toBe(201);
    await page.goto(f.server.url+"/usage");await page.getByRole("button",{name:"Load more projects",exact:true}).click();await page.getByRole("combobox",{name:"Project",exact:true}).selectOption(f.projectId);
    await page.getByLabel("From UTC",{exact:true}).fill(f.from);await page.getByLabel("To UTC",{exact:true}).fill(f.to);await page.getByRole("button",{name:"Apply usage filters",exact:true}).click();
    await page.getByRole("button",{name:"Load more price snapshots",exact:true}).click();await page.getByRole("combobox",{name:"Price snapshot",exact:true}).selectOption(priceId);await expect(page.getByRole("heading",{name:"Local estimate",exact:true})).toBeVisible();
    await page.getByLabel("Snapshot name",{exact:true}).fill("Unsaved selection draft");await command(second,"/projects",{name:"Synthetic selection refresh"});
    await expect(page.getByText("Showing 50 of 52 projects, including archived projects.",{exact:true})).toBeVisible();
    const project=page.getByRole("combobox",{name:"Project",exact:true}),price=page.getByRole("combobox",{name:"Price snapshot",exact:true});
    await expect(project).toHaveValue(f.projectId);await expect(project.locator("option:checked")).toHaveText(/Synthetic usage project/);await expect(price).toHaveValue(priceId);await expect(price.locator("option:checked")).toHaveText(/Synthetic retained older price/);
    const preview=await command(second,"/retention/preview",{cutoff:new Date(Date.now()-1).toISOString()}),v=preview.body.data;expect(preview.status).toBe(200);expect((await command(second,"/retention/prune",{previewId:v.previewId,expectedGeneration:v.expectedGeneration,expectedVersion:v.expectedVersion,candidateDigest:v.candidateDigest})).status).toBe(200);
    await expect(project).toHaveValue(f.projectId);await expect(project.locator("option:checked")).toHaveText(/Synthetic usage project/);await expect(price).toHaveValue(priceId);await expect(price.locator("option:checked")).toHaveText(/Synthetic retained older price/);
    await expect(page.getByRole("heading",{name:"Local estimate",exact:true})).toBeVisible();await expect(page.getByText("USD 0.000017",{exact:true})).toBeVisible();await expect(page.getByLabel("Snapshot name",{exact:true})).toHaveValue("Unsaved selection draft");
    const reads=f.browserRequests.filter(x=>(x as {method:string}).method==="GET"&&new URL((x as {url:string}).url).pathname.endsWith("/usage"));expect(new URL((reads.at(-1) as {url:string}).url).searchParams.get("projectId")).toBe(f.projectId);expect(new URL((reads.at(-1) as {url:string}).url).searchParams.get("priceSnapshotId")).toBe(priceId);
  } finally {await other.close();await f.finish();}
});

 test("usage appearance batch", async ({ page }) => {
  test.skip(!process.env.W03C_TASK4_APPEARANCE, "Appearance is a single explicitly released batch.");
  const f = await fixture(page, "appearance", 3);
  try {
    await f.event(f.runs[0], "run.usage", f.usage("complete", 12345, 67)); await f.event(f.runs[1], "run.usage", f.usage("partial", null, 7)); await f.open();
    let capturePrice: string | null = null;
    if (process.env.W03C_TASK4_CAPTURE_ESTIMATE) {
      const created=await command(page,"/usage/price-snapshots",{id:randomUUID(),name:"Synthetic capture rates",capturedAt:new Date().toISOString(),entries:[{source:"fixture",model:"model",currency:"USD",inputPrice:"1",outputPrice:"2"}]});expect(created.status).toBe(201);capturePrice=created.body.data.id;
      await page.getByRole("combobox",{name:"Price snapshot",exact:true}).selectOption(capturePrice!);await expect(page.getByRole("heading",{name:"Local estimate",exact:true})).toBeVisible();
    }
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
    const profile=mkdtempSync(join(process.env.W03C_TASK4_DATA_DIR ?? tmpdir(),"usage-zoom-"));chmodSync(profile,0o700);
    const context=await chromium.launchPersistentContext(profile,{channel:"chrome",headless:true,viewport:null,args:["--window-size=1440,1000"]}),zoomPage=await context.newPage();
    try {
      await pairPage(zoomPage,f.server);const before=await zoomPage.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio}));
      await zoomPage.goto("chrome://settings/appearance");await zoomPage.locator("select#zoomLevel").selectOption("2");await zoomPage.goto(f.server.url+"/usage");await zoomPage.emulateMedia({reducedMotion:"reduce"});
      await zoomPage.getByRole("combobox",{name:"Project",exact:true}).selectOption(f.projectId);await zoomPage.getByLabel("From UTC",{exact:true}).fill(f.from);await zoomPage.getByLabel("To UTC",{exact:true}).fill(f.to);await zoomPage.getByRole("button",{name:"Apply usage filters"}).focus();await zoomPage.keyboard.press("Enter");await expect(zoomPage.getByRole("heading",{name:"Reporting coverage",exact:true})).toBeVisible();if(capturePrice){await zoomPage.getByRole("combobox",{name:"Price snapshot",exact:true}).selectOption(capturePrice);await expect(zoomPage.getByRole("heading",{name:"Local estimate",exact:true})).toBeVisible();}
      const after=await zoomPage.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio,cssZoom:getComputedStyle(document.body).zoom,motion:matchMedia("(prefers-reduced-motion: reduce)").matches}));expect(after.width).toBeLessThan(before.width*.6);expect(after.dpr).toBeGreaterThan(before.dpr*1.9);expect(after.cssZoom).toBe("1");
      expect(await zoomPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const result=await new AxeBuilder({page:zoomPage}).include("#main-content").analyze();expect(result.violations).toEqual([]);
      await zoomPage.evaluate(()=>scrollTo(0,0));const path=join(proof!,"native-200-"+process.env.W03C_TASK4_APPEARANCE+".png");const cdp=await context.newCDPSession(zoomPage);const metrics=await cdp.send("Page.getLayoutMetrics");const shot=await cdp.send("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false});const bytes=Buffer.from(shot.data,"base64");expect(bytes.readUInt32BE(16)).toBe(metrics.layoutViewport.clientWidth);writeFileSync(path,bytes,{mode:0o600});await cdp.detach();captures.push({name:"native-200",profile,before,after,path,axe:result.violations,metrics,captureScope:"Actual native browser viewport at document top; original bytes",width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});
    } finally {await context.close();}
    await f.finish({ captures });
  } finally { if (f.server.child.exitCode === null) await f.finish(); }
});
