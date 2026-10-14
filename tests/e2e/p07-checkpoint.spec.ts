import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { launch } from "../fixtures/server";
import { pairPage } from "../fixtures/p03";
import { journey } from "../fixtures/p06-producer";

test("joined offline CLI observations and synthetic browser acceptance reopen history survive stopped restore in two contexts", async ({ page, browser }) => {
  test.setTimeout(90000);
  let server = await launch();
  const other = await browser.newContext();
  const second = await other.newPage();
  const producer = journey(server);
  for(const context of [page.context(),other]) await context.route("**/*",route=>new URL(route.request().url()).origin===server.url?route.continue():route.abort());
  const evidence: unknown[] = [];
  async function next(stage: string) { const value = await producer.next(); expect(value.stage).toBe(stage); evidence.push(value); return value; }
  try {
    const ids = await next("registered");
    await pairPage(page, server);
    await pairPage(second, server);
    for (const tab of [page, second]) {
      await tab.goto(server.url + `/projects/${ids.projectId}`);
      await expect(tab.getByText("Connected updates", { exact: true })).toBeVisible();
      await expect(tab.getByRole("button", { name: "Synthetic P06 CLI walkthrough", exact: true })).toBeVisible();
      const storage=await tab.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));
      expect(storage).not.toContain(server.credentials().pairingToken);expect(storage).not.toContain(server.credentials().reporterToken);
      expect(tab.url()).not.toContain(server.credentials().pairingToken);expect(tab.url()).not.toContain(server.credentials().reporterToken);

    }
    producer.advance(); await next("running");
    for (const tab of [page, second]) {
      await expect(tab.locator(".task-card").getByText("running · Fresh report", { exact: true })).toBeVisible();
      await tab.goto(server.url + `/runs/${ids.implementationId}`);
      await expect(tab.getByText("3 · run.progress", { exact: true })).toBeVisible();
      expect(tab.url()).toBe(server.url + `/runs/${ids.implementationId}`);
      const raw = await tab.evaluate(async id => (await (await fetch(`/api/v1/runs/${id}/events`)).json()).data.items, ids.implementationId);
      expect(raw.map((e: { sequence: number; runId: string }) => [e.runId,e.sequence])).toEqual([1,2,3].map(n => [ids.implementationId,n]));
    }
    producer.advance(); await next("offline-request");
    const { dir, port } = server; await server.stop(); producer.advance();
    await next("queued");
    server = await launch({ dir, port }); producer.advance(); await next("recovered");
    for (const tab of [page, second]) {
      await expect(tab.getByText("Connected updates", { exact: true })).toBeVisible({ timeout: 15000 });
      await expect(tab.getByText("4 · run.progress", { exact: true })).toBeVisible();
    }
    producer.advance(); await next("implementation-review");
    for (const tab of [page, second]) {
      await expect(tab.getByText("succeeded · Terminal record", { exact: true })).toBeVisible();
      await tab.goto(server.url + `/projects/${ids.projectId}`);
      await expect(tab.getByRole("region", { name: "Review", exact: true }).getByRole("button", { name: "Synthetic P06 CLI walkthrough", exact: true })).toBeVisible();
      if (process.env.AGENTFLOW_P07_EVIDENCE_DIR) await tab.screenshot({ path: join(process.env.AGENTFLOW_P07_EVIDENCE_DIR, tab === page ? "producer-review-tab1.png" : "producer-review-tab2.png"), fullPage: true });
    }
    producer.advance(); await next("verification-running");
    for (const tab of [page, second]) {
      await tab.goto(server.url + `/runs/${ids.verificationId}`);
      await expect(tab.getByText("2 · run.heartbeat", { exact: true })).toBeVisible();
    }
    producer.advance(); const done = await next("done");
    expect(await producer.exit, producer.errors()).toBe(0);
    for (const tab of [page, second]) {
      await expect(tab.getByText("succeeded · Terminal record", { exact: true })).toBeVisible();
      const snapshot = await tab.evaluate(async id => (await (await fetch(`/api/v1/tasks/${id}`)).json()).data.task, ids.taskId);
      expect(snapshot).toMatchObject({ id: ids.taskId, status: "review", version: 5, workRevision: 2 });
      const raw = await tab.evaluate(async id => (await (await fetch(`/api/v1/runs/${id}/events`)).json()).data.items, ids.verificationId);
      expect(raw.map((e: { sequence: number; runId: string }) => [e.runId,e.sequence])).toEqual([1,2,3].map(n => [ids.verificationId,n]));
    }
    expect(done.taskStatus).toBe("review");
    await page.goto(server.url+`/projects/${ids.projectId}`);
    await page.getByRole("button",{name:"Synthetic P06 CLI walkthrough",exact:true}).click();
    await page.getByRole("button",{name:"Move task",exact:true}).last().click();
    await page.getByRole("menuitem",{name:"Completed",exact:true}).click();
    await page.getByLabel("Acceptance evidence note",{exact:true}).fill("Synthetic P07 fixture, never a human attestation.");
    await page.getByRole("button",{name:"Complete current revision"}).click();
    await expect(page.locator(".task-context")).toContainText("Completed");
    await second.goto(server.url+`/projects/${ids.projectId}`);
    await expect(second.getByRole("region",{name:"Completed",exact:true}).getByRole("button",{name:"Synthetic P06 CLI walkthrough",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Reopen task"}).click();
    await page.getByLabel("Reason for reopening").fill("Synthetic P07 follow-up");
    await page.getByRole("button",{name:"Confirm reopen"}).click();
    await expect(page.getByLabel("Title",{exact:true})).toBeEnabled();
    const backup=join(producer.dir,"checkpoint.sqlite");
    const oldGeneration=await page.evaluate(async()=> (await (await fetch("/api/v1/overview?timezone=UTC")).json()).generation);
    await server.stop();
    const env={...process.env,AGENTFLOW_DATA_DIR:dir,PORT:String(port)};
    const backupOutput=execFileSync(process.execPath,["--import","tsx","src/cli/local.ts","backup","--output",backup],{env,encoding:"utf8"});
    expect(backupOutput).toContain("Integrity ok");
    const restoreOutput=execFileSync(process.execPath,["--import","tsx","src/cli/local.ts","restore","--from",backup],{env,encoding:"utf8"});
    expect(restoreOutput).toContain("Browser sessions were revoked");
    server=await launch({dir,port});
    for(const tab of [page,second]){
      await expect(tab.getByRole("heading",{name:"Pair again to keep editing"})).toBeVisible({timeout:20000});
      await tab.getByLabel("Pairing token",{exact:true}).fill(server.credentials().pairingToken);
      await tab.getByRole("button",{name:"Pair this browser",exact:true}).click();
      await expect(tab.getByText("Connected updates",{exact:true})).toBeVisible({timeout:15000});
      const state=await tab.evaluate(async id=> (await (await fetch(`/api/v1/tasks/${id}`)).json()),ids.taskId);
      expect(state.generation).not.toBe(oldGeneration);expect(state.data.task.status).toBe("backlog");
      await tab.goto(server.url+`/projects/${ids.projectId}/tasks/${ids.taskId}`);
      await expect(tab.getByText("Synthetic P07 follow-up",{exact:true})).toBeVisible();
      await expect(tab.getByText("Synthetic P07 fixture, never a human attestation.",{exact:true})).toBeVisible();
    }
    evidence.push({stage:"joined acceptance reopen backup restore",synthetic:true,tabsRevokedAndRepaired:2,backupOutput,restoreOutput});

    if (process.env.AGENTFLOW_P07_EVIDENCE_DIR) writeFileSync(join(process.env.AGENTFLOW_P07_EVIDENCE_DIR, "browser.json"), JSON.stringify({ evidence, tabs: 2, claim: "journey observation only, no sustained/burst visibility claim", owned: [server.dir, producer.dir] }, null, 2) + "\n", { mode: 0o600 });
  } finally { await producer.close(); await other.close(); await page.close(); await server.stop(); }
});

test("actual CLI failure and real silence remain observed uncertainty in two independent contexts",async({page,browser})=>{
  test.setTimeout(110000);
  const server=await launch(),other=await browser.newContext(),second=await other.newPage();
  const { registeredRun }=await import("../fixtures/p06-cli");const {randomUUID}=await import("node:crypto");
  const f=await registeredRun(server),transcript:unknown[]=[];
  async function cli(args:string[]){const result=await f.cli(args);transcript.push({args,result});expect(result.code).toBe(0);return JSON.parse(result.stdout);}
  try{
    for(const tab of [page,second]){await tab.context().route("**/*",route=>new URL(route.request().url()).origin===server.url?route.continue():route.abort());await pairPage(tab,server);}
    await cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})]);
    await cli(["report","--run",f.runId,"--type","run.failed","--payload",f.file({message:"Synthetic P07 failure observation"})]);
    for(const tab of [page,second]){await tab.goto(server.url+`/runs/${f.runId}`);await expect(tab.getByText("failed · Terminal record",{exact:true})).toBeVisible();await expect(tab.getByText("Synthetic P07 failure observation",{exact:true}).first()).toBeVisible();}
    const silent=randomUUID();await cli(["run","register","--file",f.file({id:silent,projectId:f.projectId,agentId:f.agentId,purpose:"planning"}),"--idempotency-key",randomUUID()]);
    const ack=await cli(["report","--run",silent,"--type","run.started","--payload",f.file({})]);
    const received=Date.parse(ack.receivedAt);
    for(const tab of [page,second]){await tab.goto(server.url+`/runs/${silent}`);await expect(tab.getByText("running · Fresh report",{exact:true})).toBeVisible();await expect(tab.getByText("Connected updates",{exact:true})).toBeVisible();}
    await Promise.all([page,second].map(tab=>expect(tab.getByText("running · Stale report · execution uncertain",{exact:true})).toBeVisible({timeout:75000})));
    expect(Date.now()-received).toBeGreaterThan(60000);expect(Date.now()-received).toBeLessThan(75000);
    for(const tab of [page,second])await expect(tab.getByText("Connected updates",{exact:true})).toBeVisible();
    if(process.env.AGENTFLOW_P07_EVIDENCE_DIR)writeFileSync(join(process.env.AGENTFLOW_P07_EVIDENCE_DIR,"cli-failure-silence.json"),JSON.stringify({synthetic:true,dir:server.dir,outbox:f.dir,transcript,receivedAt:ack.receivedAt,silenceObservedAt:new Date().toISOString(),contexts:2},null,2),{mode:0o600});
  }finally{await other.close();await server.stop();}
});
