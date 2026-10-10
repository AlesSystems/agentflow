import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir, release } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { chromium, expect } from "@playwright/test";
import Database from "better-sqlite3";
import { z } from "zod";
import { cliConfig } from "../../src/cli/config";
import { openOutbox } from "../../src/cli/outbox";
import { canonicalDigest } from "../../src/domain/request-digest";
import { taskDetailResponse, tasksResponse, boardResponse, overviewResponse } from "../../src/contracts/responses";
import { eventResponse, eventsResponse } from "../../src/contracts/observations";
import { trackingRunsResponse } from "../../src/contracts/tracking";
import { launch, pair, freePort } from "../fixtures/server";
import { publicProxy } from "../fixtures/p06-proxy";
import { seedPerformance } from "../fixtures/p06-performance";

const baselineSha = "787865132d89a9b03f613942f64945887bc13f95";
const mode = process.argv[2];
assert(["--smoke", "--acceptance"].includes(mode), "Select --smoke or reviewed quiet-window --acceptance explicitly");
const acceptance = mode === "--acceptance";
const evidence = process.env.AGENTFLOW_P06_EVIDENCE_DIR;
assert(evidence, "AGENTFLOW_P06_EVIDENCE_DIR required");
assert(statSync(evidence).isDirectory(), "evidence directory required");
assert(!existsSync(join(evidence, "performance.json")), "Use a fresh evidence directory; never overwrite a run");
const counts = acceptance ? { tasks: 1000, events: 10000, producers: 10, queued: 1000, samples: 100, repetitions: 3 } : { tasks: 12, events: 20, producers: 2, queued: 4, samples: 5, repetitions: 1 };
const root = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-p06-performance-"));
const owned: string[] = [root];
const addonProbe = new Database(":memory:"); addonProbe.close();
const sqliteAddon = Object.keys(createRequire(import.meta.url).cache).find(path => path.includes("/better-sqlite3/") && path.endsWith(".node"));
assert(sqliteAddon,"loaded SQLite addon fingerprint required");
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function fileHashes(dir: string): Record<string, string> {
  const result: Record<string,string> = {};
  for (const entry of readdirSync(dir, { recursive: true })) {
    const path = join(dir, String(entry));
    if (statSync(path).isFile()) result[relative(dir,path)] = hash(readFileSync(path));
  }
  return result;
}
function distribution(samples: number[]) {
  assert(samples.length, "missing samples");
  const sorted = [...samples].sort((a,b) => a-b);
  return { count: samples.length, p50Ms: sorted[Math.ceil(sorted.length*.5)-1], p95Ms: sorted[Math.ceil(sorted.length*.95)-1], maxMs: sorted.at(-1)!, samplesMs: samples };
}
const receipt: { mode: string; acceptance: boolean; startedAt: string; runtime: unknown; provenance: unknown; owned: string[]; flush: unknown[]; comparisons: unknown[]; failures: string[]; finishedAt?: string; cleanup?: string } = {
  mode: acceptance ? "acceptance" : "smoke", acceptance, startedAt: new Date().toISOString(),
  runtime: { node: process.version, osRelease: release(), platform: process.platform, arch: process.arch, macOS: execFileSync("sw_vers", [], { encoding: "utf8" }).trim(), npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim() },
  provenance: {}, owned, flush: [], comparisons: [], failures: [],
};
function save() { writeFileSync(join(evidence!, "performance.json"), JSON.stringify(receipt,null,2)+"\n", { mode: 0o600 }); }
async function cli(args: string[], env: Record<string,string>) {
  const t = performance.now();
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli/main.ts", ...args], { env: { ...process.env, ...env, FORCE_COLOR: undefined }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => stdout += chunk); child.stderr.on("data", chunk => stderr += chunk);
  const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
  const code = await new Promise<number | null>((resolve,reject) => { child.once("error",reject); child.once("exit",resolve); }).finally(() => clearTimeout(timer));
  return { code, elapsedMs: performance.now()-t, stdout, stderr };
}
async function flushRun(index: number) {
  const setupStart = performance.now();
  const dir = join(root, `flush-${index}`), inputs = join(root, `inputs-${index}`), outboxDir = join(root, `outbox-${index}`);
  mkdirSync(inputs, { mode: 0o700 });
  const fixture = await seedPerformance(dir, counts);
  let server: Awaited<ReturnType<typeof launch>> | undefined;
  let proxy: Awaited<ReturnType<typeof publicProxy>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let outbox: Awaited<ReturnType<typeof openOutbox>> | undefined;
  const result = { index, fixture, dataset: counts, tabs: 0, setupMs: 0, queued: 0, accepted: null as number|null, missing: null as number|null, duplicate: null as number|null, totalQueuedBytes: 0, queuedRecords: [] as { body: Record<string,unknown>; digest: string; bytes: number; fileSha256: string }[], queueInvocations: [] as Awaited<ReturnType<typeof cli>>[], flushInvocations: [] as Awaited<ReturnType<typeof cli>>[], elapsedMs: null as number|null, measuredStartedMs: null as number|null, measuredEndedMs: null as number|null, reconciliationStatus: "unfinalized", requestCounts: { accepted: 0, limited429: 0, errors: 0, attempts: 0 }, requests: [] as { eventId: string; sequence: number; digest: string; bytes: number; status: number }[], reconciliation: null as unknown, failure: "" };
  receipt.flush.push(result); save();
  try {
    server = await launch({ dir });
    const token = join(inputs,"reporter-token"); writeFileSync(token, server.credentials().reporterToken, { mode: 0o600 });
    proxy = await publicProxy(server, (req, body, reply) => {
      if (reply && req.method === "POST" && req.url?.endsWith("/events")) {
        const event = JSON.parse(body.toString());
        result.requests.push({ eventId: event.eventId, sequence: event.sequence, digest: canonicalDigest(event), bytes: body.length, status: reply.status });
        result.requestCounts.attempts++;
        if ([200,201].includes(reply.status)) result.requestCounts.accepted++;
        else if (reply.status === 429) result.requestCounts.limited429++;
        else result.requestCounts.errors++;
      }
      return undefined;
    });
    const env = { PORT: String(proxy.port), AGENTFLOW_REPORTER_TOKEN_FILE: token, AGENTFLOW_OUTBOX_DIR: outboxDir };
    const envBefore = { ...process.env };
    Object.assign(process.env, env);
    let config;
    try { config = cliConfig(); } finally { process.env = envBefore; }
    outbox = await openOutbox(config, performance.now()+5000);
    assert(outbox.acquireDelivery(), "fixture delivery lease required");
    browser = await chromium.launch({ channel: process.env.AGENTFLOW_TEST_BROWSER === "chrome" ? "chrome" : undefined });
    const cookie = await pair(server);
    for (let tab = 0; tab < 2; tab++) {
      const context = await browser.newContext();
      await context.addCookies([{ name: "agentflow_session", value: cookie.slice(cookie.indexOf("=")+1), url: server.url }]);
      const page = await context.newPage(); await page.goto(server.url + `/projects/${fixture.projectId}`);
      await expect(page.getByText("Connected updates", { exact: true })).toBeVisible(); result.tabs++;
    }
    const empty = join(inputs,"empty.json"); writeFileSync(empty,"{}",{ mode: 0o600 });
    for (let sequence = 1; sequence <= counts.queued/counts.producers; sequence++) {
      for (const runId of fixture.runs) {
        const invocation = await cli(["report","--run",runId,"--type",sequence === 1 ? "run.started" : "run.heartbeat","--payload",empty],env);
        result.queueInvocations.push(invocation); assert.equal(invocation.code,2,"real CLI observation must remain durable under fixture delivery lease");
      }
    }
    outbox.close(); outbox = undefined;
    for (const runId of fixture.runs) {
      for (const filename of readdirSync(join(outboxDir,runId)).filter(name=>/^\d+-.*\.json$/.test(name))) {
        const bytes = readFileSync(join(outboxDir,runId,filename));
        const record = JSON.parse(bytes.toString());
        assert.equal(record.digest,canonicalDigest(record.body));
        result.queuedRecords.push({ body: record.body, digest: record.digest, bytes: bytes.length, fileSha256: hash(bytes) });
      }
    }
    result.queuedRecords.sort((a,b)=>String(a.body.runId).localeCompare(String(b.body.runId))||Number(a.body.sequence)-Number(b.body.sequence));
    result.queued = result.queuedRecords.length; assert.equal(result.queued,counts.queued);
    result.totalQueuedBytes = result.queuedRecords.reduce((sum,r)=>sum+r.bytes,0);
    result.setupMs = performance.now()-setupStart; save();
    const measured = performance.now(); result.measuredStartedMs=measured;
    for (;;) {
      const invocation = await cli(["flush"],env); result.flushInvocations.push(invocation);
      assert([0,2].includes(invocation.code!),"flush blocked or local failure");
      if (invocation.code === 0) break;
      if (performance.now()-measured >= 120000) break;
    }
    result.measuredEndedMs=performance.now(); result.elapsedMs = result.measuredEndedMs-measured;
    const db = new Database(join(dir,"agentflow.sqlite"), { readonly: true });
    try {
      const actual = db.prepare("SELECT event_id,run_id,sequence,digest,body FROM run_events WHERE run_id IN ("+fixture.runs.map(()=>"?").join(",")+") ORDER BY run_id,sequence").all(...fixture.runs) as {event_id:string;run_id:string;sequence:number;digest:string;body:string}[];
      const ids = new Set(actual.map(row=>row.event_id));
      result.accepted = actual.length; result.duplicate = actual.length-ids.size;
      result.missing = result.queuedRecords.filter(row=>!ids.has(String(row.body.eventId))).length;
      for (const row of result.queuedRecords) {
        const persisted = actual.find(event=>event.event_id===row.body.eventId);
        assert(persisted,"immutable queued event missing");
        assert.equal(persisted.digest,row.digest); assert.equal(persisted.sequence,row.body.sequence);
        const { receivedAt, ...storedInput } = JSON.parse(persisted.body);
        assert.equal(typeof receivedAt,"string"); assert.equal(canonicalDigest(storedInput),row.digest);
      }
      const api: unknown[] = [];
      for (const runId of fixture.runs) {
        let cursor: string | null = null;
        do {
          const reply: Response = await fetch(server.url+`/api/v1/runs/${runId}/events?limit=100`+(cursor?`&cursor=${encodeURIComponent(cursor)}`:""),{headers:{Authorization:"Bearer "+server.credentials().reporterToken}});
          assert.equal(reply.status,200);
          const page = eventsResponse.parse(await reply.json()); api.push(...page.data.items); cursor=page.data.nextCursor;
        } while(cursor);
      }
      assert.deepEqual((api as {eventId:string}[]).map(e=>e.eventId).sort(),[...ids].sort());
      result.reconciliation = { tasks: (db.prepare("SELECT count(*) n FROM tasks").get() as {n:number}).n, agents: (db.prepare("SELECT count(*) n FROM agents").get() as {n:number}).n, runs: (db.prepare("SELECT count(*) n FROM runs").get() as {n:number}).n, events: (db.prepare("SELECT count(*) n FROM run_events").get() as {n:number}).n, apiCount: api.length, immutableIdsSha256: hash(JSON.stringify([...ids].sort())) };
      assert.equal((result.reconciliation as {events:number}).events,counts.events+counts.queued);
      result.reconciliationStatus="finalized";
    } finally { db.close(); }
    assert.equal(result.missing,0); assert.equal(result.duplicate,0); assert.equal(result.accepted,counts.queued);
    assert.equal(result.requestCounts.errors,0);
    if (acceptance) assert(result.elapsedMs<120000,"1,000-event flush exceeds 120 seconds");
  } catch (error) {
    if(result.measuredStartedMs!==null&&result.measuredEndedMs===null){result.measuredEndedMs=performance.now();result.elapsedMs=result.measuredEndedMs-result.measuredStartedMs;}
    result.failure = error instanceof Error ? error.message : "unknown"; throw error;
  }
  finally { outbox?.close(); await browser?.close(); await proxy?.close(); await server?.stop(); save(); }
}

async function compare(index: number, baseSource: string, seed: Awaited<ReturnType<typeof seedPerformance>>, seedDir: string) {
  const labels = index % 2 ? ["base","head"] as const : ["head","base"] as const;
  const servers: Partial<Record<"base"|"head", Awaited<ReturnType<typeof launch>>>> = {};
  const operations: Record<string,{base:number[];head:number[]}> = Object.fromEntries(["ingestion","tasks","detail","board","overview","tracking","events"].map(name=>[name,{base:[],head:[]} ]));
  const result = { index, order: labels, requests: [] as {label:string;operation:string;ordinal:number;warmup:boolean;status:number;ms:number;eventId?:string;digest?:string}[], operations: {} as Record<string,unknown>, missing: 0, limited429: 0, errors: 0, failure: "" };
  receipt.comparisons.push(result); save();
  try {
    for (const label of labels) {
      const dir=join(root,`comparison-${index}-${label}`); cpSync(seedDir,dir,{recursive:true});
      servers[label]=await launch({dir,cwd:label==="base"?baseSource:process.cwd(),port:await freePort()});
    }
    const reads: Record<string,{path:string;schema:z.ZodType}> = {tasks:{path:`/tasks?projectId=${seed.projectId}&limit=50`,schema:tasksResponse}, detail:{path:`/tasks/${seed.tasks[0]}`,schema:taskDetailResponse}, board:{path:`/projects/${seed.projectId}/board`,schema:boardResponse}, overview:{path:"/overview?timezone=UTC",schema:overviewResponse}, tracking:{path:`/tracking/runs?projectId=${seed.projectId}&limit=50`,schema:trackingRunsResponse}, events:{path:`/runs/${seed.historic[0]}/events?limit=50`,schema:eventsResponse}};
    for (let ordinal = 0; ordinal < counts.samples+10; ordinal++) {
      const producer=ordinal%counts.producers, sequence=Math.floor(ordinal/counts.producers)+1;
      const body={schemaVersion:1,eventId:randomUUID(),runId:seed.runs[producer],sequence,type:sequence===1?"run.started":"run.heartbeat",occurredAt:"2026-10-10T00:00:00.000Z",payload:{}};
      for (const operation of ["ingestion",...Object.keys(reads)]) {
        for (const label of ordinal % 2 ? [...labels].reverse() : labels) {
          const server=servers[label]!;
          const t=performance.now();
          const reply=await fetch(server.url+"/api/v1"+(operation==="ingestion"?`/runs/${body.runId}/events`:reads[operation].path),{method:operation==="ingestion"?"POST":"GET",headers:{Authorization:"Bearer "+server.credentials().reporterToken,...(operation==="ingestion"?{"Content-Type":"application/json"}:{})},body:operation==="ingestion"?JSON.stringify(body):undefined,redirect:"manual"});
          const raw=await reply.json(); const ms=performance.now()-t;
          result.requests.push({label,operation,ordinal,warmup:ordinal<10,status:reply.status,ms,...(operation==="ingestion"?{eventId:body.eventId,digest:canonicalDigest(body)}:{})});
          if(reply.status===429)result.limited429++;else if(!reply.ok)result.errors++;
          assert.equal(reply.status,operation==="ingestion"?201:200,"native operation rejected; retain failed raw sample");
          (operation==="ingestion"?eventResponse:reads[operation].schema).parse(raw);
          if(ordinal>=10)operations[operation][label].push(ms);
        }
      }
    }
    for(const [operation,samples]of Object.entries(operations)) {
      assert.equal(samples.base.length,counts.samples);assert.equal(samples.head.length,counts.samples);
      const base=distribution(samples.base),head=distribution(samples.head),changePercent=(head.p95Ms/base.p95Ms-1)*100;
      result.operations[operation]={base,head,p95ChangePercent:changePercent};
      if(acceptance){if(base.p95Ms>=250||head.p95Ms>=250)receipt.failures.push(`comparison ${index} ${operation} native p95 >=250ms`);if(changePercent>20)receipt.failures.push(`comparison ${index} ${operation} p95 regression ${changePercent}% >20%`);}
    }
    result.missing=Object.values(operations).reduce((sum,s)=>sum+2*counts.samples-s.base.length-s.head.length,0);
  } catch(error) { result.failure=error instanceof Error?error.message:"unknown"; throw error; }
  finally {
    for(const [operation,samples] of Object.entries(operations)) if(!result.operations[operation]) {
      const absent = { count: 0, p50Ms: null, p95Ms: null, maxMs: null, samplesMs: [] };
      result.operations[operation] = { base: samples.base.length ? distribution(samples.base) : absent, head: samples.head.length ? distribution(samples.head) : absent };
    }
    result.missing=Object.values(operations).reduce((sum,s)=>sum+2*counts.samples-s.base.length-s.head.length,0);
    for(const server of Object.values(servers))await server?.stop(); save();
  }
}
try {
  const baseSource=join(root,"p05-source");mkdirSync(baseSource,{mode:0o700});
  const archive=execFileSync("git",["archive",baselineSha],{maxBuffer:20*1024*1024});
  execFileSync("tar",["-xf","-","-C",baseSource],{input:archive});
  assert.equal(hash(readFileSync("package-lock.json")),hash(readFileSync(join(baseSource,"package-lock.json"))),"baseline/head dependency lock must match");
  symlinkSync(join(process.cwd(),"node_modules"),join(baseSource,"node_modules"));
  const baseBuildDir = process.env.AGENTFLOW_P06_BASE_BUILD_DIR ?? join(process.cwd(),".next");
  assert(isAbsolute(baseBuildDir),"baseline build directory must be absolute");
  const baseBuildId = readFileSync(join(baseBuildDir,"BUILD_ID"),"utf8").trim();
  if (acceptance) assert.equal(baseBuildId,"hL87_8rkkJoB-OPCgH1dH","Select retained P05 cached assets for acceptance");
  cpSync(baseBuildDir,join(baseSource,".next"),{recursive:true});
  receipt.provenance={baselineSha,headSha:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),workingDiffSha256:hash(execFileSync("git",["diff","HEAD"])),baseArchiveSha256:hash(archive),lockSha256:hash(readFileSync("package-lock.json")),baselineLockSha256:hash(readFileSync(join(baseSource,"package-lock.json"))),sqliteAddonSha256:hash(readFileSync(sqliteAddon)),baselineCachedBuildId:baseBuildId,headCachedBuildId:readFileSync(".next/BUILD_ID","utf8").trim(),baselineCachedAssets:process.env.AGENTFLOW_P06_BASE_BUILD_DIR ? "explicit retained P05 assets" : "current assets copied before later head rebuild",cachedBuildHashes:fileHashes(join(baseSource,".next")),helperHashes:Object.fromEntries(["tests/performance/p06.ts","tests/fixtures/p06-performance.ts","tests/fixtures/p06-proxy.ts","tests/fixtures/server.ts","src/cli/main.ts","src/cli/outbox.ts","src/cli/http.ts","src/cli/config.ts"].map(path=>[path,hash(readFileSync(path))])),comparison:"Equivalent native public HTTP operations on copied identical synthetic dataset. P05 has no CLI. Cached assets copied before later head rebuild; native HTTP uses each label's source."};
  save();
  for(let index=1;index<=counts.repetitions;index++)await flushRun(index);
  const seedDir=join(root,"comparison-seed");const seed=await seedPerformance(seedDir,counts);
  for(let index=1;index<=counts.repetitions;index++)await compare(index,baseSource,seed,seedDir);
  assert.equal(receipt.failures.length,0,"performance budget failures remain open");
} catch(error) {
  receipt.failures.push(error instanceof Error?error.message:"unknown failure"); process.exitCode=1;
} finally {
  receipt.finishedAt=new Date().toISOString(); receipt.cleanup="All owned browsers, server children, proxy sockets, timers, outbox/SQLite connections closed in finally. Synthetic root retained for exact-candidate review and enumerated cleanup.";save();
  console.log(JSON.stringify({mode:receipt.mode,acceptance,flushRuns:receipt.flush.length,comparisons:receipt.comparisons.length,failures:receipt.failures}));
}
