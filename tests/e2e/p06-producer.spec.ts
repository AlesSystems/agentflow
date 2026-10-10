import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "../fixtures/server";
import { pairPage } from "../fixtures/p03";
import { journey } from "../fixtures/p06-producer";

test("two real tabs observe the external CLI producer, downtime replay, Review, and a separate verification attempt", async ({ page, browser }) => {
  test.setTimeout(60000);
  let server = await launch();
  const other = await browser.newContext();
  const second = await other.newPage();
  const producer = journey(server);
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
    }
    producer.advance(); await next("running");
    for (const tab of [page, second]) {
      await expect(tab.getByText("running · Fresh report", { exact: true })).toBeVisible();
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
      if (process.env.AGENTFLOW_P06_EVIDENCE_DIR) await tab.screenshot({ path: join(process.env.AGENTFLOW_P06_EVIDENCE_DIR, tab === page ? "producer-review-tab1.png" : "producer-review-tab2.png"), fullPage: true });
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
    if (process.env.AGENTFLOW_P06_EVIDENCE_DIR) writeFileSync(join(process.env.AGENTFLOW_P06_EVIDENCE_DIR, "browser.json"), JSON.stringify({ evidence, tabs: 2, claim: "journey observation only, no sustained/burst visibility claim", owned: [server.dir, producer.dir] }, null, 2) + "\n", { mode: 0o600 });
  } finally { await producer.close(); await other.close(); await page.close(); await server.stop(); }
});
