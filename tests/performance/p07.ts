import {nativeCompare} from "../fixtures/p07-native";
import {ordinaryStages,ordinaryBoundary} from "../fixtures/p07-ordinary";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir, release } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { chromium, expect } from "@playwright/test";
import Database from "better-sqlite3";
import { cliConfig } from "../../src/cli/config";
import { openOutbox } from "../../src/cli/outbox";
import { canonicalDigest } from "../../src/domain/request-digest";
import { launch, pair } from "../fixtures/server";
import { publicProxy } from "../fixtures/p06-proxy";
import { seedPerformance } from "../fixtures/p06-performance";

import {flushBoundary} from "../fixtures/p07-flush-boundary";
import {collectFlush,validateFlush,type FlushFacts,type Queued,type Attempt} from "../fixtures/p07-flush";
import { loadScenario, resourceProof } from "../fixtures/p07-load";
const baselineSha = "36f6d1bc4699c706e3f57a17cfcc85a1576c648b";
const mode = process.argv[2];
assert(["--smoke", "--acceptance"].includes(mode), "Select --smoke or reviewed quiet-window --acceptance explicitly");
const acceptance = mode === "--acceptance";
const evidence = process.env.AGENTFLOW_P07_EVIDENCE_DIR;
assert(evidence, "AGENTFLOW_P07_EVIDENCE_DIR required");
assert(statSync(evidence).isDirectory(), "evidence directory required");
assert(!existsSync(join(evidence, "performance.json")), "Use a fresh evidence directory; never overwrite a run");
const counts = acceptance ? { tasks: 1000, events: 10000, producers: 10, queued: 1000, samples: 100, repetitions: 3 } : { tasks: 12, events: 20, producers: 2, queued: 4, samples: 5, repetitions: 1 };
const root = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-p07-performance-"));
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
const receipt: { mode: string; acceptance: boolean; startedAt: string; runtime: unknown; provenance: unknown; owned: string[]; flush: unknown[]; comparisons: unknown[]; failures: string[]; finishedAt?: string; cleanup?: string } = {
  mode: acceptance ? "acceptance" : "smoke", acceptance, startedAt: new Date().toISOString(),
  runtime: { node: process.version, osRelease: release(), platform: process.platform, arch: process.arch, macOS: execFileSync("sw_vers", [], { encoding: "utf8" }).trim(), npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim() },
  provenance: {}, owned, flush: [], comparisons: [], failures: [],
};
function writeReceipt() { writeFileSync(join(evidence!, "performance.json"), JSON.stringify(receipt,null,2)+"\n", { mode: 0o600 }); }
let save=writeReceipt;
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
  const result = { index, fixture, dataset: counts, tabs: 0, setupMs: 0, queued: 0, accepted: null as number|null, missing: null as number|null, duplicate: null as number|null, totalQueuedBytes: 0, queuedRecords: [] as Queued[], queueFilesRaw: [] as {filename:string;bytesBase64:string}[], queueInvocations: [] as Awaited<ReturnType<typeof cli>>[], flushInvocations: [] as Awaited<ReturnType<typeof cli>>[], elapsedMs: null as number|null, measuredStartedMs: null as number|null, measuredEndedMs: null as number|null, reconciliationStatus: "unfinalized", requestCounts: { accepted: 0, limited429: 0, errors: 0, attempts: 0 }, requests: [] as Attempt[], reconciliationRaw: null as FlushFacts|null, reconciliation: null as unknown, failure: "" };
  receipt.flush.push(result);
  await flushBoundary(result,async()=>{
    writeReceipt();
    server = await launch({ dir });
    const token = join(inputs,"reporter-token"); writeFileSync(token, server.credentials().reporterToken, { mode: 0o600 });
    const pendingRequests=new WeakMap<object,Attempt>();
    proxy = await publicProxy(server, (req, body, reply) => {
      if(req.method==="POST"&&req.url?.endsWith("/events")){
        if(!reply){const attempt={requestBytesBase64:body.toString("base64"),responseBytesBase64:null,status:null,generation:null};result.requests.push(attempt);pendingRequests.set(req,attempt);result.requestCounts.attempts++;}
        else{const attempt=pendingRequests.get(req)!;attempt.responseBytesBase64=reply.body.toString("base64");attempt.status=reply.status;attempt.generation=reply.generation;if([200,201].includes(reply.status))result.requestCounts.accepted++;else if(reply.status===429)result.requestCounts.limited429++;else result.requestCounts.errors++;}
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
        result.queueFilesRaw.push({filename:`${runId}/${filename}`,bytesBase64:bytes.toString("base64")});
        const record = JSON.parse(bytes.toString());
        assert.equal(record.digest,canonicalDigest(record.body));
        result.queuedRecords.push({ body: record.body, digest: record.digest, bytes: bytes.length, fileSha256: hash(bytes), filename: `${runId}/${filename}`, originalBytesBase64: bytes.toString("base64") });
      }
    }
    result.queuedRecords.sort((a,b)=>String(a.body.runId).localeCompare(String(b.body.runId))||Number(a.body.sequence)-Number(b.body.sequence));
    result.queued = result.queuedRecords.length; assert.equal(result.queued,counts.queued);
    result.totalQueuedBytes = result.queuedRecords.reduce((sum,r)=>sum+r.bytes,0);
    result.setupMs = performance.now()-setupStart; writeReceipt();
    const measured = performance.now(); result.measuredStartedMs=measured;
    for (;;) {
      const invocation = await cli(["flush"],env); result.flushInvocations.push(invocation);
      assert([0,2].includes(invocation.code!),"flush blocked or local failure");
      if (invocation.code === 0) break;
      if (performance.now()-measured >= 120000) break;
    }
    result.measuredEndedMs=performance.now(); result.elapsedMs = result.measuredEndedMs-measured;
    const facts:FlushFacts={expected:{...counts,runs:fixture.runs},queued:result.queuedRecords,attempts:result.requests,stdout:result.flushInvocations.map(invocation=>invocation.stdout),generation:null,database:null,pages:[],files:[]};
    result.reconciliationRaw=facts;writeReceipt();
    await collectFlush(facts,dir,outboxDir,server);
    result.reconciliation=validateFlush(facts);
    result.accepted=counts.queued;result.missing=0;result.duplicate=0;result.reconciliationStatus="finalized";
    if (acceptance) assert(result.elapsedMs<120000,"1,000-event flush exceeds 120 seconds");
  },[["outbox",async()=>{outbox?.close();}],["browser",async()=>{await browser?.close();}],["proxy",async()=>{await proxy?.close();}],["server",async()=>{await server?.stop();}]],writeReceipt);
}


await ordinaryBoundary(receipt,async safeSave=>{
  save=safeSave;
  assert.equal(execFileSync("git",["diff",baselineSha,"--","src","migrations","package.json","package-lock.json","next.config.ts"],{encoding:"utf8"}),"","Retained baseline build only applies to byte-identical runtime/build inputs");
  const baseSource=join(root,"p06-source");mkdirSync(baseSource,{mode:0o700});
  const archive=execFileSync("git",["archive",baselineSha],{maxBuffer:20*1024*1024});
  execFileSync("tar",["-xf","-","-C",baseSource],{input:archive});
  assert.equal(hash(readFileSync("package-lock.json")),hash(readFileSync(join(baseSource,"package-lock.json"))),"baseline/head dependency lock must match");
  symlinkSync(join(process.cwd(),"node_modules"),join(baseSource,"node_modules"));
  const baseBuildDir = process.env.AGENTFLOW_P07_BASE_BUILD_DIR ?? join(process.cwd(),".next");
  assert(isAbsolute(baseBuildDir),"baseline build directory must be absolute");
  const baseBuildId = readFileSync(join(baseBuildDir,"BUILD_ID"),"utf8").trim();
  assert.equal(baseBuildId, readFileSync(".next/BUILD_ID","utf8").trim(), "P06 runtime source-equivalent retained head assets required");
  cpSync(baseBuildDir,join(baseSource,".next"),{recursive:true});
  receipt.provenance={baselineSha,headSha:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),workingDiffSha256:hash(execFileSync("git",["diff","HEAD"])),baseArchiveSha256:hash(archive),lockSha256:hash(readFileSync("package-lock.json")),baselineLockSha256:hash(readFileSync(join(baseSource,"package-lock.json"))),sqliteAddonSha256:hash(readFileSync(sqliteAddon)),baselineCachedBuildId:baseBuildId,headCachedBuildId:readFileSync(".next/BUILD_ID","utf8").trim(),baselineCachedAssets:process.env.AGENTFLOW_P07_BASE_BUILD_DIR ? "explicit retained source-equivalent assets" : "ordinary fresh-install assets copied for identical runtime/build inputs",cachedBuildHashes:fileHashes(join(baseSource,".next")),helperHashes:Object.fromEntries(["tests/performance/p07.ts","tests/fixtures/p07-load.ts","tests/fixtures/p07-protocol.ts","tests/fixtures/p07-runtime.ts","tests/fixtures/p07-flush.ts","tests/fixtures/p07-flush-boundary.ts","tests/fixtures/p07-native.ts","tests/fixtures/p07-ordinary.ts","tests/fixtures/p07-proof-errors.ts","tests/fixtures/p07-warm-error.ts","tests/fixtures/p07-resource-boundary.ts","tests/fixtures/p06-performance.ts","tests/fixtures/p06-proxy.ts","tests/fixtures/server.ts","src/cli/main.ts","src/cli/outbox.ts","src/cli/http.ts","src/cli/config.ts"].map(path=>[path,hash(readFileSync(path))])),comparison:"Equivalent native public HTTP operations on copied identical synthetic dataset. P06 runtime source bytes equal head runtime before helper-only changes. Ordinary fresh-install assets reused for identical runtime/build inputs; native HTTP uses each label's source."};
  save();
  await ordinaryStages({repetitions:counts.repetitions,
    load:async index=>{console.log(JSON.stringify({stage:"load",index,acceptance}));const result=await loadScenario(root,index,acceptance);(receipt as unknown as Record<string,unknown[]>).loads??=[];(receipt as unknown as Record<string,unknown[]>).loads.push(result);save();},
    resource:async()=>{(receipt as unknown as Record<string,unknown>).resources=await resourceProof(root,acceptance);save();},flush:flushRun,
    prepareNative:async()=>{const seedDir=join(root,"comparison-seed");return {seedDir,seed:await seedPerformance(seedDir,counts)};},
    compare:async(index,input)=>{await nativeCompare({index,baseSource,...input,root,counts,acceptance,receipt,save:writeReceipt});}
  });
  assert.equal(receipt.failures.length,0,"performance budget failures remain open");
},writeReceipt,()=>console.log(JSON.stringify({mode:receipt.mode,acceptance,flushRuns:receipt.flush.length,comparisons:receipt.comparisons.length,failures:receipt.failures})),()=>{process.exitCode=1;}).catch(()=>{process.exitCode=1;});
