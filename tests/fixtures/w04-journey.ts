import assert from "node:assert/strict";
export type JourneyWitness = {
  cli: { exitCode: number | null; closed: boolean }[];
  tabs: { independentlyPaired: boolean; view: "graph" | "list"; nodeRunId: string }[];
  workflow: { revisions: string[]; immutableHistory: boolean };
  retention: { priorGeneration: string; generation: string; exactReplay: boolean };
  audit: { stopped: boolean; copied: boolean; foreignKeys: unknown[] };
};
export function validateJourney(witness: JourneyWitness) {
  assert(witness.cli.length > 0 && witness.cli.every(c => c.exitCode === 0 && c.closed), "drained successful CLI required");
  assert.equal(witness.tabs.length, 2, "two independent sessions required");
  assert(witness.tabs.every(t => t.independentlyPaired && t.nodeRunId === witness.tabs[0].nodeRunId), "linked attempt agreement required");
  assert.deepEqual(witness.tabs.map(t => t.view).sort(), ["graph", "list"]);
  assert.equal(new Set(witness.workflow.revisions).size, 2);
  assert(witness.workflow.immutableHistory, "immutable revision evidence required");
  assert.notEqual(witness.retention.generation, witness.retention.priorGeneration);
  assert(witness.retention.exactReplay, "exact receipt replay required");
  assert(witness.audit.stopped && witness.audit.copied, "stopped copy required");
  assert.deepEqual(witness.audit.foreignKeys, []);
}

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, readdirSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import Database from "better-sqlite3";
import { chromium, expect,  } from "@playwright/test";
import { launch } from "./server";
import { pairPage, command } from "./p03";
import { publicProxy, type Reply } from "./p06-proxy";
import { canonicalDigest } from "../../src/domain/request-digest";
import { historyLine, historyManifest, historyComplete } from "../../src/contracts/history";
import { usageResponse } from "../../src/contracts/usage";

const bounds = { startupMs: 30000, healthMs: 2000, terminateMs: 10000, killMs: 5000 };
export async function joinedJourney(name: string) {
  const parent = process.env.AGENTFLOW_W04_JOURNEY_ROOT;
  assert(parent && parent.startsWith("/"), "owned journey parent required");
  const root = mkdtempSync(join(parent, name + "-")); chmodSync(root, 0o700);
  const data = join(root, "data"), outbox = join(root, "outbox"), audit = join(root, "audit");
  for (const path of [data, audit]) mkdirSync(path, { mode: 0o700 });
  const save = (name: string, value: unknown) => writeFileSync(join(root, name + ".json"), JSON.stringify(value, null, 2), { mode: 0o600 });
  let sentinel: ReturnType<typeof spawn> | undefined; let sentinelClosed: Promise<void> | undefined;
  const sentinelFact = { argv: [] as string[], pid: undefined as number | undefined, sourceSHA256: "", stdout: "", stderr: "", exitCode: null as number | null, signal: null as string | null, closed: false, intentionalCleanup: false };
  const browserRecords: { profile: string; closeEvent: boolean }[] = [];
  const commands: { argv: string[]; pid: number | undefined; exitCode: number | null; signal: string | null; closed: boolean; stdout: string; stderr: string }[] = [];
  const cliWires: { method: string; path: string; key: string | undefined; body: unknown; digest: string; status: number; text: string; generation: string | null }[] = [];
  const browserWires: { method: string; path: string; key: string | undefined; body: unknown; digest: string; status: number; text: string; generation: string | undefined }[] = [];
  const browserCaptures = new Set<Promise<void>>();
  const requests: unknown[] = [], services: unknown[] = [], wires: unknown[] = [], proofs: unknown[] = [];
  const remoteState = { status: 200, head: "a".repeat(40), retry: "60" };
  const credential = join(root, "github-token.json"); writeFileSync(credential, JSON.stringify({ token: "SYNTHETIC_W04_TOKEN" }), { mode: 0o600 });
  const remote = createServer((req, res) => {
    wires.push({ method: req.method, url: req.url, version: req.headers["x-github-api-version"] });
    if (remoteState.status === 0) { req.socket.destroy(); return; }
    res.statusCode = remoteState.status;
    if (remoteState.status === 429) res.setHeader("Retry-After", remoteState.retry);
    const item = { number: 9, html_url: "https://github.com/synthetic/w04/pull/9", title: "Synthetic W04 PR", state: "open", draft: false, head: { sha: remoteState.head }, base: { ref: "main" }, merged_at: null };
    res.end(JSON.stringify(remoteState.status === 200 ? item : { message: "SYNTHETIC_REMOTE_ERROR" }));
  });
  let fixtureOrigin = "";
  let server!: Awaited<ReturnType<typeof launch>>, serviceClosed!: Promise<void>, port: number | undefined, stopped = true;
  async function start() {
    const capture = { argv: [] as string[], pid: undefined as number | undefined, stdout: "", stderr: "", exitCode: null as number | null, signal: null as string | null, closed: false };
    server = await launch({ dir: data, port, bounds, entry: "tests/fixtures/w03a-server.ts", extraEnv: { AGENTFLOW_GITHUB_TOKEN_FILE: credential, W03A_FIXTURE_ORIGIN: fixtureOrigin }, onChild(child) {
      capture.argv = child.spawnargs; capture.pid = child.pid;
      child.stdout!.on("data", c => capture.stdout += c); child.stderr!.on("data", c => capture.stderr += c);
      serviceClosed = new Promise(resolve => child.once("close", (code, signal) => { capture.exitCode = code; capture.signal = signal; capture.closed = true; resolve(); }));
      services.push(capture);
    } });
    port = server.port; stopped = false;
  }
  async function stop() { if (!stopped) { await server.stop(); await serviceClosed; stopped = true; } }
  const token = join(root, "reporter-token");
  let inputIndex = 0;
  const file = (body: unknown) => { const path = join(root, `input-${inputIndex++}.json`); writeFileSync(path, JSON.stringify(body), { mode: 0o600 }); return path; };
  async function cli(args: string[], expected = 0, selectedPort = proxy?.port ?? port!) {
    const argv = ["--import", "tsx", "src/cli/main.ts", ...args];
    const child = spawn(process.execPath, argv, { env: { ...process.env, PORT: String(selectedPort), AGENTFLOW_REPORTER_TOKEN_FILE: token, AGENTFLOW_OUTBOX_DIR: outbox }, stdio: ["ignore", "pipe", "pipe"] });
    const fact = { argv: [process.execPath, ...argv], pid: child.pid, exitCode: null as number | null, signal: null as string | null, closed: false, stdout: "", stderr: "" }; commands.push(fact);
    child.stdout.on("data", c => fact.stdout += c); child.stderr.on("data", c => fact.stderr += c);
    const timer = setTimeout(() => child.kill("SIGKILL"), 25000);
    try { await new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => { fact.exitCode = code; fact.signal = signal; fact.closed = true; resolve(); }); }); } finally { clearTimeout(timer); save("commands", commands); }
    assert.equal(fact.exitCode, expected, fact.stderr); assert(child.stdout.destroyed && child.stderr.destroyed, "CLI streams drained");
    return fact;
  }
  const register = async (args: string[], body: unknown) => JSON.parse((await cli([...args, "--file", file(body), "--idempotency-key", randomUUID()])).stdout).id as string;
  const report = async (id: string, type: string, payload: unknown = {}, workflow = false, expected = 0, selectedPort = proxy?.port ?? port!) => cli(["report", workflow ? "--workflow-run" : "--run", id, "--type", type, "--payload", file(payload)], expected, selectedPort);
  async function api(path: string, body?: unknown, expected = 200) {
    const response = await fetch(server.url + "/api/v1" + path, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer " + server.credentials().reporterToken, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text(); const parsed = JSON.parse(text);
    requests.push({ path, body, status: response.status, generation: response.headers.get("agentflow-generation"), text }); save("requests", requests);
    assert.equal(response.status, expected, text); return parsed;
  }
  const contexts = [] as Awaited<ReturnType<typeof chromium.launchPersistentContext>>[];
  let proxy: Awaited<ReturnType<typeof publicProxy>> | undefined;
  const eventBodies: { path: string; body: { eventId: string; runId?: string; workflowRunId?: string; sequence: number }; digest: string; reply: Reply }[] = [];
  let dropUsage = false;
  try {
    await new Promise<void>(resolve => remote.listen(0, "127.0.0.1", resolve));
    fixtureOrigin = `http://127.0.0.1:${(remote.address() as { port: number }).port}`;
    await start(); writeFileSync(token, server.credentials().reporterToken, { mode: 0o600 });
    for (let i = 0; i < 2; i++) {
      const profile = join(root, "profile-" + i); mkdirSync(profile, { mode: 0o700 });
      const context = await chromium.launchPersistentContext(profile, { channel: "chrome", headless: true, viewport: { width: 1440, height: 1000 } }); contexts.push(context); const record = { profile, closeEvent: false }; browserRecords.push(record); context.once("close", () => record.closeEvent = true);
    }
    const page = await contexts[0].newPage(), second = await contexts[1].newPage(), tabs = [page, second];
    for (const tab of tabs) await pairPage(tab, server);
    const sessionHashes = await Promise.all(contexts.map(async context => { const cookie = (await context.cookies()).find(c => c.name === "agentflow_session"); assert(cookie); return createHash("sha256").update(cookie.value).digest("hex"); }));
    assert.notEqual(sessionHashes[0], sessionHashes[1], "independent pairing cookies"); save("independent-session-identities", { sessionHashes });
    page.on("response", response => {
      const request = response.request(), path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/v1/") || ["GET", "HEAD"].includes(request.method())) return;
      const capturing = (async () => { const body = JSON.parse(request.postData()!); browserWires.push({ method: request.method(), path, key: request.headers()["idempotency-key"], body, digest: canonicalDigest(body), status: response.status(), text: await response.text(), generation: response.headers()["agentflow-generation"] }); save("browser-command-wires", browserWires); })(); browserCaptures.add(capturing); void capturing.finally(() => browserCaptures.delete(capturing));
    });
    proxy = await publicProxy(server, (req, bytes, reply) => {
      if (reply) { const body = bytes.length ? JSON.parse(bytes.toString()) : null; cliWires.push({ method: req.method!, path: req.url!, key: typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : undefined, body, digest: canonicalDigest(body), status: reply.status, text: reply.body.toString(), generation: reply.generation }); save("cli-command-wires", cliWires); }
      if (reply && req.url?.endsWith("/events")) {
        const body = JSON.parse(bytes.toString()); eventBodies.push({ path: req.url, body, digest: canonicalDigest(body), reply }); save("event-wires", eventBodies);
        if (dropUsage && body.type === "run.usage") return { drop: true };
      }
    }, { httpMs: 5000, closeMs: 5000 });
    const projectId = await register(["project", "create"], { name: "Synthetic W04 joined production journey" });
    const agentId = await register(["agent", "register"], { displayName: "Synthetic W04 reporter", source: "fixture", defaultRole: "implementation" });
    const ids: string[] = [];
    for (const title of ["Diamond root", "Diamond left", "Diamond right", "Rework target", "Silence queued", "Silence running", "Prunable prior attempt"]) ids.push(await register(["task", "create"], { projectId, title }));
    const [d, b, c, a, q, s, pruneTask] = ids;
    const current = async (id: string) => (await api("/tasks/" + id)).data;
    const human = async (path: string, body: unknown, method = "POST", expected = 200) => { const reply = await command(page, path, body, method); requests.push({ path, input: body, method, ...reply, principal: "synthetic-browser" }); save("requests", requests); assert.equal(reply.status, expected, JSON.stringify(reply)); return reply.body; };
    for (const [id, prerequisiteIds] of [[a, [b, c]], [b, [d]], [c, [d]]] as [string, string[]][]) await human(`/tasks/${id}/dependencies`, { expectedVersion: (await current(id)).task.version, prerequisiteIds }, "PUT");
    for (const id of [d, b, c]) { await human(`/tasks/${id}`, { expectedVersion: (await current(id)).task.version, status: "review" }, "PATCH"); await human(`/tasks/${id}/complete`, { expectedVersion: (await current(id)).task.version, evidenceNote: "Synthetic browser-role prerequisite acceptance" }, "POST", 201); }
    const workflowId = randomUUID(), revisions = [randomUUID(), randomUUID()], nodes = [d, b, c, a].map((taskId, i) => ({ id: randomUUID(), label: ["Root", "Left", "Right", "Target"][i], taskId })), unknownNode = { id: randomUUID(), label: "Unobserved node" };
    const edges = [[0, 1], [0, 2], [1, 3], [2, 3]].map(([source, target]) => ({ source: nodes[source].id, target: nodes[target].id }));
    await register(["register", "workflow"], { id: workflowId, projectId, name: "Synthetic diamond" });
    await register(["register", "workflow-revision", "--workflow", workflowId], { id: revisions[0], expectedWorkflowVersion: 1, nodes: [...nodes, unknownNode], edges });
    const historicalPlan = await api(`/workflows/${workflowId}/revisions/${revisions[0]}`);
    const graphUrl = () => server.url + `/projects/${projectId}/workflows?workflowId=${workflowId}&revisionId=${revisions[0]}&nodeId=${nodes[3].id}`;
    await page.goto(graphUrl()); await second.goto(graphUrl() + "&view=list");
    for (const tab of tabs) await expect(tab.getByText("Skill Unknown", { exact: true }).first()).toBeVisible();
    await page.getByRole("link", { name: "Open linked task", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${a}`));
    await page.getByText("Edit prerequisites and review evidence", { exact: true }).click();
    await page.getByLabel("Require reported review", { exact: true }).check(); await page.getByLabel("Require reported verification", { exact: true }).check();
    await page.getByRole("button", { name: "Save review policy", exact: true }).click(); await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
    const run = async (taskId: string, purpose = "implementation", tuple = {}) => register(["run", "register"], { id: randomUUID(), projectId, agentId, taskId, purpose, expectedTaskVersion: (await current(taskId)).task.version, ...tuple });
    const failed = await run(a); await report(failed, "run.started", {}, false, 0, proxy.port); await report(failed, "run.failed", { message: "Synthetic failure" }, false, 0, proxy.port);
    assert.equal((await api(`/runs/${failed}`)).data.state, "failed");
    const first = await run(a); await report(first, "run.started", {}, false, 0, proxy.port);
    const usage = (usageId: string, inputTokens: number | null, outputTokens: number | null, source = "fixture", model = "model") => ({ usageId, source, model, measuredAt: "2026-01-01T00:00:00.000Z", inputTokens, outputTokens, billingBasis: "input_output_only" });
    dropUsage = true; await report(first, "run.usage", usage("known", 3, 7), false, 2, proxy.port);
    const lost = eventBodies.find(e => (e.body as { type?: string }).type === "run.usage")!;
    dropUsage = false; await cli(["flush", "--run", first], 0, proxy.port);
    const replay = eventBodies.filter(e => e.body.eventId === lost.body.eventId); assert(replay.length >= 2); for (const wire of replay) assert.deepEqual(wire.reply.body, lost.reply.body);
    await report(first, "run.usage", usage("known", 3, 7), false, 0, proxy.port);
    await report(first, "run.usage", usage("partial", null, 5), false, 0, proxy.port);
    await report(first, "run.usage", usage("mixed", 2, 8, "other", "other-model"), false, 0, proxy.port);
    await stop(); await report(first, "run.succeeded", { summary: "Synthetic prior artifact", artifactRef: "synthetic:artifact-v1" }, false, 2);
    await expect(second.getByText(/Reconnecting|Polling for updates/)).toBeVisible({ timeout: 15000 });
    await start(); await cli(["flush", "--run", first], 0, proxy.port);
    for (const tab of tabs) await expect(tab.getByText("Connected updates", { exact: true })).toBeVisible({ timeout: 15000 });
    const wfRun = await register(["register", "workflow-run"], { id: randomUUID(), workflowId, planRevisionId: revisions[0] });
    await report(wfRun, "workflow.started", {}, true, 0, proxy.port); await report(wfRun, "workflow.node.reported", { nodeId: nodes[3].id, runId: first, state: "succeeded" }, true, 0, proxy.port); await report(wfRun, "workflow.succeeded", { summary: "Synthetic old revision" }, true, 0, proxy.port);
    const historicalNodes = await api(`/workflow-runs/${wfRun}/snapshot`);
    const workflowOriginal = eventBodies.find(e => e.body.workflowRunId === wfRun)!;
    await api(`/workflow-runs/${wfRun}/events`, { ...workflowOriginal.body, sequence: 9, eventId: randomUUID() }, 409);
    await api(`/workflow-runs/${wfRun}/events`, { ...workflowOriginal.body, occurredAt: "2026-01-01T00:00:00.000Z" }, 409);
    assert.deepEqual((await api(`/workflow-runs/${wfRun}/snapshot`)).data, historicalNodes.data);
    await register(["register", "workflow-revision", "--workflow", workflowId], { id: revisions[1], expectedWorkflowVersion: 2, nodes: [...nodes.map(n => ({ ...n, label: n.label + " revised" })), unknownNode], edges });
    assert.deepEqual((await api(`/workflows/${workflowId}/revisions/${revisions[0]}`)).data, historicalPlan.data);
    const gate = async (decision: "approved" | "changes_requested", purpose = "review") => { const t = (await current(a)).task; const id = await run(a, purpose, { workRevision: t.workRevision, artifactRef: (await current(a)).evidence.currentArtifact.artifactRef, reworkRound: t.reworkRound }); await report(id, "run.started", {}, false, 0, proxy!.port); await report(id, "run.succeeded", { summary: "Synthetic gate", decision, evidenceNote: "Synthetic " + decision }, false, 0, proxy!.port); return id; };
    await gate("changes_requested"); await human(`/tasks/${a}/complete`, { expectedVersion: (await current(a)).task.version, evidenceNote: "Blocked synthetic acceptance" }, "POST", 409);
    const obsolete = (await current(a)).task;
    await expect(page.getByText("Review · Required · Changes requested", { exact: true })).toBeVisible();
    await page.getByLabel("Reason for rework", { exact: true }).fill("Synthetic explicit rework"); await page.getByRole("button", { name: "Return to Backlog for rework", exact: true }).click();
    await expect(page.getByText(/Rework round 1/).first()).toBeVisible();
    const revised = await run(a); await report(revised, "run.started", {}, false, 0, proxy.port); await report(revised, "run.usage", usage("known", 4, 6), false, 0, proxy.port); await report(revised, "run.succeeded", { summary: "Synthetic revised artifact", artifactRef: "synthetic:artifact-v2" }, false, 0, proxy.port);
    await api("/runs", { id: randomUUID(), projectId, agentId, taskId: a, purpose: "review", expectedTaskVersion: (await current(a)).task.version, workRevision: obsolete.workRevision, artifactRef: "synthetic:artifact-v1", reworkRound: obsolete.reworkRound }, 409);
    await gate("approved"); await gate("approved", "verification");
    await api(`/tasks/${a}/complete`, { expectedVersion: (await current(a)).task.version, evidenceNote: "Reporter must not accept" }, 403);
    await human(`/tasks/${b}/reopen`, { expectedVersion: (await current(b)).task.version, reason: "Synthetic prerequisite reopened" });
    await human(`/tasks/${a}/complete`, { expectedVersion: (await current(a)).task.version, evidenceNote: "Blocked by prerequisite" }, "POST", 409);
    await human(`/tasks/${b}`, { expectedVersion: (await current(b)).task.version, status: "review" }, "PATCH"); await human(`/tasks/${b}/complete`, { expectedVersion: (await current(b)).task.version, evidenceNote: "Synthetic prerequisite reacceptance" }, "POST", 201);
    await page.getByRole("button", { name: "Move task", exact: true }).click(); await page.getByRole("menuitem", { name: "Completed", exact: true }).click();
    await page.getByLabel("Acceptance evidence note", { exact: true }).fill("Synthetic browser-role acceptance, never human attestation"); await page.getByRole("button", { name: "Complete current revision", exact: true }).click();
    await expect(page.getByText("Human accepted", { exact: true }).first()).toBeVisible(); await expect(second.locator(`#current-node-${nodes[3].id}`)).toHaveText("Human accepted");
    await page.getByRole("button", { name: "Reopen task", exact: true }).click(); await page.getByLabel("Reason for reopening", { exact: true }).fill("Synthetic postacceptance follow-up"); await page.getByRole("button", { name: "Confirm reopen", exact: true }).click();
    assert.equal((await current(a)).task.status, "backlog");
    const queued = await run(q), silent = await run(s); await report(silent, "run.started", {}, false, 0, proxy.port);
    const sentinelFile = join(root, "synthetic-no-signal-sentinel.cjs");
    const sentinelSource = 'for (const signal of ["SIGINT","SIGTERM"]) process.on(signal, () => { console.log(JSON.stringify({receivedSignal:signal})); process.exit(0); }); console.log("SYNTHETIC_SENTINEL_READY"); setInterval(()=>{},1000);';
    writeFileSync(sentinelFile, sentinelSource, { mode: 0o600 }); sentinelFact.sourceSHA256 = createHash("sha256").update(sentinelSource).digest("hex"); sentinelFact.argv = [process.execPath, sentinelFile];
    save("sentinel-before-spawn", { ...sentinelFact, observerRunId: silent, qualification: "Owned synthetic sentinel, not an agent or external harness. Identity join is fixture evidence only." });
    sentinel = spawn(process.execPath, [sentinelFile], { env: { ...process.env, TMPDIR: process.env.TMPDIR }, stdio: ["ignore", "pipe", "pipe"] }); sentinelFact.pid = sentinel.pid;
    sentinel.stdout!.on("data", part => sentinelFact.stdout += part); sentinel.stderr!.on("data", part => sentinelFact.stderr += part);
    sentinelClosed = new Promise(resolve => sentinel!.once("close", (code, signal) => { sentinelFact.exitCode = code; sentinelFact.signal = signal; sentinelFact.closed = true; resolve(); }));
    await expect.poll(() => sentinelFact.stdout, { timeout: 5000 }).toContain("SYNTHETIC_SENTINEL_READY");
    assert(sentinel.pid && process.kill(sentinel.pid, 0)); save("sentinel-ready", sentinelFact);
    const firstSilent = eventBodies.find(e => e.body.runId === silent)!; const registrationReceived = Date.parse((await api(`/runs/${queued}`)).data.lastReceivedAt);
    await page.goto(server.url + `/runs/${silent}`); await second.goto(server.url + `/runs/${queued}`);
    await api(`/runs/${silent}/events`, { ...firstSilent.body, sequence: 3, eventId: randomUUID() }, 409);
    await api(`/runs/${silent}/events`, { ...firstSilent.body, occurredAt: "2026-01-01T00:00:00.000Z" }, 409);
    const freshnessBefore = (await api(`/runs/${silent}`)).data;
    await api(`/runs/${silent}/events`, firstSilent.body, 200); assert.deepEqual((await api(`/runs/${silent}`)).data, freshnessBefore);
    for (const tab of tabs) await expect(tab.getByText(/Stale report · execution uncertain/).first()).toBeVisible({ timeout: 75000 });
    assert(Date.now() - Math.min(registrationReceived, Date.parse(JSON.parse(firstSilent.reply.body.toString()).data.receivedAt)) <= 75000, "actual receipt-to-visible staleness within75 seconds");
    proofs.push({ staleVisibleAt: Date.now(), queuedReceipt: registrationReceived, runningReceipt: firstSilent.reply.body.toString(), signalScope: "No external producer process is created; browser tracking closure invokes only observer endpoint" });
    for (const tab of tabs) { await tab.getByRole("button", { name: "Close stale tracking", exact: true }).click(); await tab.getByLabel("Reason", { exact: true }).fill("Synthetic silence closure"); await tab.getByRole("button", { name: "Confirm tracking closure", exact: true }).click(); await expect(tab.getByText("Tracking record closed. No process signal was sent.", { exact: true })).toBeVisible(); }
    assert.equal(sentinelFact.exitCode, null); assert.equal(sentinelFact.signal, null); assert(!sentinelFact.stdout.includes("receivedSignal")); assert(sentinel.pid && process.kill(sentinel.pid, 0));
    save("sentinel-after-browser-closure", { ...sentinelFact, observerRunId: silent, signalZeroLivenessProbe: true, boundary: "zero SIGINT/SIGTERM during browser closure; explicit cleanup is later" });
    assert.equal((await api(`/runs/${queued}`)).data.state, "interrupted"); assert.equal((await api(`/runs/${silent}`)).data.state, "interrupted");
    const next = await run(s); await report(next, "run.started", {}, false, 0, proxy.port);
    dropUsage = true; await report(next, "run.usage", usage("post-prune-replay", null, null), false, 2, proxy.port); dropUsage = false;
    const queuedUsage = eventBodies.find(e => e.body.runId === next && (e.body as { type?: string }).type === "run.usage")!;
    save("pending-before-prune", { runId: next, state: JSON.parse(readFileSync(join(outbox, next, "state.json"), "utf8")), files: readdirSync(join(outbox, next)).map(name => ({ name, bytesBase64: readFileSync(join(outbox, next, name)).toString("base64") })) });
    const prunable = await run(pruneTask); await report(prunable, "run.started", {}, false, 0, proxy.port); await report(prunable, "run.progress", { message: "Synthetic removable payload" }, false, 0, proxy.port); await report(prunable, "run.failed", { message: "Synthetic terminal prior attempt" }, false, 0, proxy.port);
    const from = new Date(Date.now() - 86400000).toISOString(), to = new Date(Date.now() + 86400000).toISOString();
    const priceId = randomUUID(); await human("/usage/price-snapshots", { id: priceId, name: "Synthetic immutable rates", capturedAt: new Date().toISOString(), entries: [{ source: "fixture", model: "model", currency: "USD", inputPrice: "1", outputPrice: "2" }, { source: "other", model: "other-model", currency: "EUR", inputPrice: "3", outputPrice: "4" }] }, "POST", 201);
    const usagePath = `/usage?projectId=${projectId}&from=${from}&to=${to}&priceSnapshotId=${priceId}`;
    const summary = usageResponse.parse(await api(usagePath)); assert.equal(summary.data.filteredReportCount, 5); assert.equal(summary.data.unknownInputReports, 2); assert.equal(summary.data.knownInputTokens, "9"); assert.equal(summary.data.knownOutputTokens, "26"); assert.equal(summary.data.knownTotalTokens, "30");
    assert.deepEqual(summary.data.estimate?.currencies, [{ currency: "EUR", amount: "0.000038" }, { currency: "USD", amount: "0.000033" }]); assert.equal(summary.data.estimate?.excludedUnknownCounts, 2); assert.equal(summary.data.eligibleRuns, 9); assert.equal(summary.data.runsWithReports, 3); assert.equal(summary.data.runsWithoutReports, 6); assert.equal(summary.data.estimate?.excludedUnsupportedBasis, 0); assert.equal(summary.data.estimate?.excludedMissingPrice, 0);
    const firstReceipt = JSON.parse(lost.reply.body.toString()).data.receivedAt;
    const afterFirst = usageResponse.parse(await api(`/usage?projectId=${projectId}&from=${new Date(Date.parse(firstReceipt) + 1).toISOString()}&to=${to}`)); assert.equal(afterFirst.data.filteredReportCount, 4);
    await page.goto(server.url + "/usage"); await page.getByRole("combobox", { name: "Project", exact: true }).selectOption(projectId); await page.getByLabel("From UTC", { exact: true }).fill(from); await page.getByLabel("To UTC", { exact: true }).fill(to); await page.getByRole("button", { name: "Apply usage filters", exact: true }).click(); await page.getByRole("combobox", { name: "Price snapshot", exact: true }).selectOption(priceId);
    await expect(page.getByText("3 of 9 eligible runs reported usage", { exact: true })).toBeVisible(); await expect(page.getByText("6 runs without reports. Usage is unknown.", { exact: true })).toBeVisible();
    for (const label of ["USD 0.000033", "EUR 0.000038", "Estimate only. This is not a bill."]) await expect(page.getByText(label, { exact: true })).toBeVisible();
    const connection = async () => { const response = await page.request.get(server.url + "/api/v1/connections/github"); assert.equal(response.status(), 200); return (await response.json()).data; };
    await human("/connections/github/refresh", { expectedVersion: (await connection()).connection.version, repository: "synthetic/w04", number: 9 }, "POST", 409); assert.equal(wires.length, 0);
    const selection = async (enabled: boolean) => human("/connections/github/repositories", { expectedVersion: (await connection()).connection.version, enabled, repositories: ["synthetic/w04"] }, "PUT");
    const refresh = async () => human("/connections/github/refresh", { expectedVersion: (await connection()).connection.version, repository: "synthetic/w04", number: 9 });
    const taskBeforeGithub = await current(a); await selection(true); await refresh(); assert.equal(wires.length, 1);
    await page.goto(server.url + "/settings"); await expect(page.getByText("Synthetic W04 PR", { exact: true })).toBeVisible(); const beforeOffline = wires.length;
    await page.context().setOffline(true); await page.getByRole("button", { name: "Refresh local GitHub cache", exact: true }).click(); await expect(page.getByText("Local browser is offline. Cached GitHub observations are retained.", { exact: true })).toBeVisible(); await expect(page.getByText("Synthetic W04 PR", { exact: true })).toBeVisible(); assert.equal(wires.length, beforeOffline); await page.context().setOffline(false);
    remoteState.status = 0; await refresh(); assert.equal((await connection()).items[0].headSha, "a".repeat(40)); proofs.push({ deterministicSocketFailure: (await connection()).items[0].lastError, browserOfflineNoOutbound: wires.length === beforeOffline + 1 });
    remoteState.status = 500; await refresh(); assert.equal((await connection()).items[0].headSha, "a".repeat(40));
    remoteState.status = 401; await refresh(); assert((await connection()).items[0].lastError); remoteState.status = 200; await refresh(); assert.equal((await connection()).items[0].lastError, null);
    remoteState.head = "b".repeat(40); await refresh(); assert.equal((await connection()).items[0].headChanged, true);
    remoteState.status = 429; await refresh(); const rateCalls = wires.length; await human("/connections/github/refresh", { expectedVersion: (await connection()).connection.version, repository: "synthetic/w04", number: 9 }, "POST", 409); assert.equal(wires.length, rateCalls);
    await selection(false); assert.equal((await connection()).items[0].stale, true); await expect(page.getByText("Disconnected · stale observation", { exact: true })).toBeVisible(); assert.deepEqual(await current(a), taskBeforeGithub);
    const generation = (await api("/foundation")).generation;
    await page.goto(server.url + "/settings");
    for (const label of ["Tasks and protected facts", "Attempts and raw reports", "Workflow history", "Private GitHub observations"]) await page.getByLabel(label, { exact: true }).check();
    const downloading = page.waitForEvent("download"); await page.getByRole("button", { name: "Download selected history", exact: true }).click();
    const download = await downloading; await download.saveAs(join(root, "browser-download.jsonl")); assert.equal(await download.failure(), null);
    const exportText = readFileSync(join(root, "browser-download.jsonl"), "utf8");
    const exported = exportText.trim().split("\n").map(line => historyLine.parse(JSON.parse(line))); const manifest = historyManifest.parse(exported[0]);
    assert.deepEqual(historyComplete.parse(exported.at(-1)).counts, manifest.counts);
    for (const [kind, count] of Object.entries(manifest.counts)) assert.equal(exported.filter(row => row.kind === kind).length, count);
    assert.equal(manifest.schemaVersion, 2); assert.equal(manifest.counts.usageMeasurement, 5); assert.equal(manifest.counts.usagePriceSnapshot, 1);
    for (const secret of [server.credentials().reporterToken, server.credentials().pairingToken, "SYNTHETIC_W04_TOKEN", "secret_hash", '\"kind\":\"session\"', '\"kind\":\"receipt\"']) assert(!exportText.includes(secret));
    for (let i = 0; i < 110; i++) await human(`/tasks/${a}/comments`, { text: "Synthetic export boundary " + i + " " + "x".repeat(3000) }, "POST", 201);
    const cookie = (await contexts[0].cookies()).map(c => c.name + "=" + c.value).join("; ");
    const concurrentResponse = await fetch(server.url + `/api/v1/export?content=tasks,attempts,workflows,github&generation=${generation}`, { headers: { Cookie: cookie } }); assert.equal(concurrentResponse.status, 200);
    const concurrentReader = concurrentResponse.body!.getReader(), parts: Uint8Array[] = []; const firstPart = await concurrentReader.read(); assert(!firstPart.done); parts.push(firstPart.value);
    await human(`/tasks/${a}/comments`, { text: "Synthetic write after frozen export snapshot" }, "POST", 201);
    for (;;) { const part = await concurrentReader.read(); if (part.done) break; parts.push(part.value); } concurrentReader.releaseLock();
    const concurrentText = Buffer.concat(parts).toString(); writeFileSync(join(root, "concurrent-download.jsonl"), concurrentText, { mode: 0o600 }); assert(!concurrentText.includes("Synthetic write after frozen export snapshot"));
    const concurrentManifest = historyManifest.parse(JSON.parse(concurrentText.split("\n")[0])); assert.equal(concurrentManifest.counts.comment, 110); assert.deepEqual(historyComplete.parse(JSON.parse(concurrentText.trim().split("\n").at(-1)!)).counts, concurrentManifest.counts);
    const abort = new AbortController(); const interrupted = await fetch(server.url + `/api/v1/export?content=tasks,attempts,workflows,github&generation=${generation}`, { headers: { Cookie: cookie }, signal: abort.signal }); const reader = interrupted.body!.getReader(); await reader.read(); abort.abort(); await reader.cancel().catch(() => {});
    await expect.poll(() => readdirSync(join(data, "exports")), { timeout: 10000 }).toEqual([]);
    proofs.push({ browserDownload: { filename: download.suggestedFilename(), complete: true }, concurrentManifest, exportSnapshotCleanup: readdirSync(join(data, "exports")), interruptedStatus: interrupted.status });
    const oldCursor = (await api(`/tasks?projectId=${projectId}&limit=1`)).data.nextCursor;
    const preview = (await human("/retention/preview", { cutoff: new Date().toISOString() })).data;
    const prune = (await human("/retention/prune", { previewId: preview.previewId, expectedGeneration: preview.expectedGeneration, expectedVersion: preview.expectedVersion, candidateDigest: preview.candidateDigest })).data;
    assert.notEqual(prune.generation, generation); assert.equal(prune.applied.eventPayloads, 1);
    const prunedEvents = (await api(`/runs/${prunable}/events`)).data.items; assert.equal(prunedEvents.find((event: { type: string }) => event.type === "run.progress").payload, null); assert(prunedEvents.find((event: { type: string }) => event.type === "run.progress").payloadPrunedAt);
    const staleStream = await fetch(server.url + `/api/v1/changes/stream?after=0&generation=${generation}`, { headers: { Cookie: cookie } }); assert.equal(staleStream.status, 200); const resetText = await staleStream.text(); assert(resetText.includes("event: reset")); proofs.push({ oldGenerationReset: resetText, priorGeneration: generation, generation: prune.generation, prunedEvents });
    await api(`/tasks?projectId=${projectId}&limit=1&cursor=${encodeURIComponent(oldCursor)}`, undefined, 400);
    assert.deepEqual(usageResponse.parse(await api(usagePath)).data, summary.data);
    const oldRetry = await api(lost.path.replace(/^\/api\/v1/, ""), lost.body, 200); assert.deepEqual(oldRetry, JSON.parse(lost.reply.body.toString())); const pruneReplay = await cli(["flush", "--run", next], 0, proxy.port); assert.equal(JSON.parse(pruneReplay.stdout).eventId, queuedUsage.body.eventId); assert.equal(JSON.parse(pruneReplay.stdout).generation, prune.generation);
    const replayAfterPrune = eventBodies.filter(e => e.body.eventId === queuedUsage.body.eventId); assert(replayAfterPrune.length >= 2); assert.equal(replayAfterPrune.filter(wire => wire.reply.status === 201).length, 1); for (const wire of replayAfterPrune) assert.deepEqual(wire.reply.body, replayAfterPrune[0].reply.body); assert.equal(replayAfterPrune.at(-1)!.reply.generation, prune.generation);
    save("pending-after-prune-flush", { runId: next, state: JSON.parse(readFileSync(join(outbox, next, "state.json"), "utf8")), files: readdirSync(join(outbox, next)) });
    for (const tab of tabs) { await tab.goto(graphUrl() + (tab === second ? "&view=list" : "")); await expect(tab.getByText("Connected updates", { exact: true })).toBeVisible({ timeout: 15000 }); }
    assert.deepEqual((await api(`/workflow-runs/${wfRun}/snapshot`)).data, historicalNodes.data);
    await stop(); await start();
    for (const tab of tabs) { await tab.reload(); await expect(tab.getByText("Connected updates", { exact: true })).toBeVisible({ timeout: 15000 }); }
    assert.equal((await current(a)).history.reopens.items.length, 1); assert.equal((await current(a)).history.completions.items.length, 1);
    const tabWitnesses = [];
    for (const [i, tab] of tabs.entries()) {
      const view = i === 0 ? "graph" as const : "list" as const; await expect(tab.getByRole("button", { name: i === 0 ? "Graph" : "List", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(tab.getByText("Skill Unknown", { exact: true }).first()).toBeVisible();
      const href = await tab.getByRole("link", { name: "Open reported attempt", exact: true }).getAttribute("href"); assert(href?.includes(first)); const graphListUrl = tab.url();
      await tab.getByRole("link", { name: "Open reported attempt", exact: true }).click(); await expect(tab).toHaveURL(new RegExp(`/runs/${first}`));
      const attemptUrl = tab.url(); await tab.goto(graphListUrl);
      const retainedCookie = (await contexts[i].cookies()).find(cookie => cookie.name === "agentflow_session"); assert(retainedCookie); assert.equal(createHash("sha256").update(retainedCookie.value).digest("hex"), sessionHashes[i]);
      const snapshot = await tab.evaluate(async first => { const response = await fetch("/api/v1/runs/" + first); return { headerGeneration: response.headers.get("agentflow-generation"), body: await response.json() }; }, first);
      assert.equal(snapshot.headerGeneration, prune.generation); assert.equal(snapshot.body.generation, prune.generation); assert.equal(snapshot.body.data.id, first);
      tabWitnesses.push({ independentlyPaired: sessionHashes[0] !== sessionHashes[1], view, nodeRunId: snapshot.body.data.id, url: tab.url(), attemptUrl, href, sessionHash: sessionHashes[i], snapshot });
      await tab.screenshot({ path: join(root, `joined-tab-${i}.png`), fullPage: true });
    }
    assert(!sentinelFact.stdout.includes("receivedSignal")); sentinelFact.intentionalCleanup = true; sentinel.kill("SIGTERM"); await sentinelClosed; assert.equal(sentinelFact.exitCode, 0); assert.equal(sentinelFact.closed, true); save("sentinel-explicit-cleanup", sentinelFact);
    await Promise.all(browserCaptures);
    await proxy.close(); proofs.push({ proxy: { port: proxy.port, closeResolved: true, inFlight: proxy.inFlight(), failures: proxy.failures } }); assert.equal(proxy.inFlight(), 0); proxy = undefined;
    await new Promise<void>(resolve => { remote.close(() => resolve()); remote.closeAllConnections(); }); assert.equal(remote.listening, false); for (const context of contexts) await context.close(); await stop();
    const physical = (dir: string) => Object.fromEntries(["", "-wal", "-shm"].filter(suffix => existsSync(join(dir, "agentflow.sqlite" + suffix))).map(suffix => { const path = join(dir, "agentflow.sqlite" + suffix), s = lstatSync(path); return [suffix, { path, dev: s.dev, ino: s.ino, mode: s.mode & 0o777, uid: s.uid, gid: s.gid, bytes: s.size, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }]; }));
    const originalBefore = physical(data);
    for (const suffix of Object.keys(originalBefore)) { copyFileSync(join(data, "agentflow.sqlite" + suffix), join(audit, "agentflow.sqlite" + suffix)); chmodSync(join(audit, "agentflow.sqlite" + suffix), 0o600); }
    const copiedBefore = physical(audit); save("stopped-copy-before-open", { stopped, originalBefore, copiedBefore, remoteListening: remote.listening });
    const db = new Database(join(audit, "agentflow.sqlite"), { readonly: true });
    let sql;
    try {
      sql = { integrity: db.pragma("integrity_check"), foreignKeys: db.pragma("foreign_key_check"), events: db.prepare<[], { event_id: string; sequence: number; digest: string; acknowledgement: string }>("SELECT event_id,run_id,sequence,type,digest,acknowledgement,payload_pruned_at FROM run_events ORDER BY run_id,sequence").all(), workflowEvents: db.prepare("SELECT * FROM workflow_events ORDER BY workflow_run_id,sequence").all(), observations: db.prepare("SELECT * FROM workflow_node_observations").all(), receipts: db.prepare<[], { principal: string; method: string; path: string; key: string; digest: string; status: number; body: string }>("SELECT * FROM receipts").all(), usage: db.prepare("SELECT * FROM usage_measurements").all(), prices: db.prepare("SELECT * FROM usage_price_snapshots").all(), gates: db.prepare("SELECT * FROM gate_decisions").all(), artifacts: db.prepare("SELECT * FROM task_artifacts").all(), dependencies: db.prepare("SELECT * FROM task_dependencies").all(), metadata: db.prepare("SELECT * FROM instance_metadata").all(), revisions: db.prepare("SELECT * FROM workflow_revisions ORDER BY revision").all() };
      save("stopped-copy-original-query-rows", sql);
      assert.deepEqual(sql.integrity, [{ integrity_check: "ok" }]); assert.deepEqual(sql.foreignKeys, []); assert.equal(sql.usage.length, 5); assert.equal(sql.gates.length, 3); assert.equal(sql.artifacts.length, 2); assert.equal(sql.dependencies.length, 4);
      for (const wire of [...cliWires, ...browserWires].filter(wire => wire.key && wire.status < 300)) { const row: { principal: string; method: string; path: string; key: string; digest: string; status: number; body: string } | undefined = sql.receipts.find(row => row.method === wire.method && row.path === wire.path && row.key === wire.key); assert(row, "committed command receipt join"); assert.equal(row.digest, wire.digest); assert.equal(row.status, wire.status);
        if (wire.path === "/api/v1/tasks" && wire.method === "POST") { const full = JSON.parse(row.body); assert.deepEqual(JSON.parse(wire.text), { data: { kind: "task", id: full.data.id, projectId: full.data.projectId, parentTaskId: full.data.parentTaskId, assignedAgentId: full.data.assignedAgentId, version: 1, workRevision: 1 }, snapshotCursor: full.snapshotCursor, generation: full.generation }); } else assert.equal(row.body, wire.text); }
      const workflowRows = db.prepare<[], { event_id: string; digest: string; acknowledgement: string }>("SELECT event_id,digest,acknowledgement FROM workflow_events").all();
      for (const wire of eventBodies.filter(wire => wire.body.workflowRunId && wire.reply.status < 300)) { const row = workflowRows.find(row => row.event_id === wire.body.eventId); assert(row); assert.equal(row.digest, wire.digest); assert.equal(row.acknowledgement, wire.reply.body.toString()); }
      assert.equal(db.prepare<[], { n: number }>("SELECT count(*) n FROM run_events WHERE payload_pruned_at IS NOT NULL").get()?.n, prune.applied.eventPayloads);
      assert.equal((sql.metadata[0] as { generation: string }).generation, prune.generation);
      for (const wire of eventBodies.filter(e => e.body.runId && e.reply.status < 300)) { const row: { event_id: string; sequence: number; digest: string; acknowledgement: string } | undefined = sql.events.find(e => e.event_id === wire.body.eventId); assert(row); assert.equal(row.digest, wire.digest); assert.equal(row.sequence, wire.body.sequence); assert.equal(row.acknowledgement, wire.reply.body.toString()); }
    } finally { db.close(); save("stopped-copy-after-close", { originalAfter: physical(data), copiedAfter: physical(audit) }); }
    const originalAfter = physical(data), copiedAfter = physical(audit); assert.deepEqual(originalAfter, originalBefore);
    save("stopped-copy-sql", { originalBefore, copiedBefore, copiedAfter, originalAfter, sql });
    const witness: JourneyWitness = { cli: commands.filter(c => c.exitCode === 0), tabs: tabWitnesses, workflow: { revisions, immutableHistory: true }, retention: { priorGeneration: generation, generation: prune.generation, exactReplay: true }, audit: { stopped, copied: true, foreignKeys: sql.foreignKeys } }; validateJourney(witness);
    assert(browserRecords.every(record => record.closeEvent));
    save("joined-result", { browserRecords, sentinelFact, root, projectId, ids, agentId, workflowId, revisions, wfRun, first, revised, queued, silent, next, witness, summary, afterFirst, historicalPlan, historicalNodes, exportManifest: manifest, preview, prune, tabWitnesses, proofs, services, commands, requests, cliWires, browserWires, wires, claim: "Synthetic browser role coverage; no actual human attestation. Optional live GitHub and Task4 appearance/performance gates unexecuted." });
    return { root, witness };
  } catch (error) {
    save("original-failure", { message: String(error), stack: error instanceof Error ? error.stack : null });
    for (const [i, context] of contexts.entries()) for (const [j, page] of context.pages().entries()) if (!page.isClosed()) { writeFileSync(join(root, `failure-${i}-${j}.html`), await page.content(), { mode: 0o600 }); await page.screenshot({ path: join(root, `failure-${i}-${j}.png`), fullPage: true }).catch(() => {}); }
    throw error;
  } finally {
    if (sentinel && !sentinelFact.closed) { sentinelFact.intentionalCleanup = true; sentinel.kill("SIGTERM"); const timer = setTimeout(() => sentinel?.kill("SIGKILL"), 5000); try { await sentinelClosed; } finally { clearTimeout(timer); } save("sentinel-explicit-cleanup", sentinelFact); }
    const cleanup = await Promise.allSettled([...(proxy ? [proxy.close()] : []), ...contexts.map(context => context.close()), stop(), new Promise<void>(resolve => { remote.close(() => resolve()); remote.closeAllConnections(); })]);
    save("cleanup-original-settlement", cleanup.map(result => result.status === "fulfilled" ? { status: result.status } : { status: result.status, reason: String(result.reason) }));
    assert(cleanup.every(result => result.status === "fulfilled"), "owned cleanup settled");
    save("final-resource-records", { sentinelFact, browserRecords, commands, services, requests, wires, proofs, stopped, browserContexts: contexts.length, remoteListening: remote.listening });
  }
}
