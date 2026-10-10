import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync,writeFileSync,readdirSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {chromium,expect} from "@playwright/test";
import {cliConfig} from "../../src/cli/config";
import {openOutbox} from "../../src/cli/outbox";
import {canonicalDigest} from "../../src/domain/request-digest";
import {launch,pair} from "./server";
import {publicProxy} from "./p06-proxy";
import {seedPerformance} from "./p06-performance";
import {flushBoundary} from "./p07-flush-boundary";
import {collectFlush,validateFlush,type FlushFacts,type Queued,type Attempt} from "./p07-flush";
export type FlushStageOptions={root:string;counts:{tasks:number;events:number;producers:number;queued:number};acceptance:boolean;receipt:{flush:unknown[]};writeReceipt:()=>void};
const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
export async function cli(args: string[], env: Record<string,string>) {
  const t = performance.now();
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli/main.ts", ...args], { env: { ...process.env, ...env, FORCE_COLOR: undefined }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => stdout += chunk); child.stderr.on("data", chunk => stderr += chunk);
  const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
  const code = await new Promise<number | null>((resolve,reject) => { child.once("error",reject); child.once("exit",resolve); }).finally(() => clearTimeout(timer));
  return { code, elapsedMs: performance.now()-t, stdout, stderr };
}
export async function flushRun(index: number, {root,counts,acceptance,receipt,writeReceipt}:FlushStageOptions) {
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
