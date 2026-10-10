import { test, expect, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { launch } from "../fixtures/server";
import { fixture } from "../fixtures/p03";
async function report(server: Awaited<ReturnType<typeof launch>>, path: string, body?: unknown) {
  const key = randomUUID();
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(server.url + "/api/v1" + path, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer " + server.credentials().reporterToken, "Content-Type": "application/json", "Idempotency-Key": key }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.status === 429) { await new Promise(resolve => setTimeout(resolve, 100)); continue; }
    expect(response.ok).toBeTruthy(); return (await response.json()).data;
  }
  throw new Error("Synthetic fixture rate limit did not recover");
}
async function event(server: Awaited<ReturnType<typeof launch>>, runId: string, sequence: number, type: string, payload: unknown = {}) {
  return report(server, `/runs/${runId}/events`, { schemaVersion: 1, eventId: randomUUID(), runId, sequence, type, occurredAt: new Date().toISOString(), payload });
}
test("an accepted 200-character unbroken reported identity wraps in direct and detached detail at 375px", async ({ page }) => {
  const server = await launch();
  try {
    const f = await fixture(page, server);
    const name = "A".repeat(200);
    const agent = await report(server, "/agents", { displayName: name, source: "public long-name fixture", defaultRole: "implementation" });
    expect(agent.displayName).toBe(name);
    const id = randomUUID();
    await report(server, "/runs", { id, projectId: f.project.id, taskId: f.task.id, agentId: agent.id, purpose: "implementation", expectedTaskVersion: 1 });
    await event(server, id, 1, "run.started");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(server.url + `/runs/${id}`);
    await expect(page.locator(".run-detail h3").first()).toHaveText(`implementation · ${name}`);
    async function noOverflow() {
      const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, headings: [...document.querySelectorAll(".run-detail h3")].map(el => ({ width: el.clientWidth, scroll: el.scrollWidth, wrap: getComputedStyle(el).overflowWrap })) }));
      expect(size.document).toBeLessThanOrEqual(size.viewport);
      expect(size.headings[0].scroll).toBeLessThanOrEqual(size.headings[0].width);
    }
    await noOverflow();
    await page.goto(f.boardUrl);
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await page.getByRole("button", { name: `implementation · ${name}`, exact: true }).click();
    await expect(page.locator(".run-detail h3").first()).toHaveText(`implementation · ${name}`);
    await noOverflow();
  } finally { await page.close(); await server.stop(); }
});
test("keyboard follows tracking records filters pages messages and stale closure while refresh retains focus and draft", async ({ page }) => {
  test.setTimeout(60000);
  let server = await launch();
  const steps: unknown[] = [];
  async function tabTo(locator: Locator, label: string) {
    await expect(locator).toBeVisible();
    for (let i = 0; i < 350; i++) {
      if (await locator.evaluate(el => el === document.activeElement)) {
        const active = await locator.evaluate(el => ({ tag: el.tagName, name: el.textContent?.slice(0, 100), focusVisible: el.matches(":focus-visible"), outlineStyle: getComputedStyle(el).outlineStyle, outlineWidth: getComputedStyle(el).outlineWidth }));
        expect(active.focusVisible).toBe(true); expect(active.outlineStyle).not.toBe("none");
        steps.push({ step: label, navigation: "Tab", active }); return;
      }
      await page.keyboard.press("Tab");
    }
    throw new Error("Keyboard target unreachable: " + label);
  }
  async function activate(locator: Locator, label: string, key = "Enter") { await tabTo(locator, label); await page.keyboard.press(key); steps.push({ step: label, activation: key }); }
  async function type(locator: Locator, label: string, value: string) { await tabTo(locator, label); await page.keyboard.press("Meta+A"); await page.keyboard.insertText(value); steps.push({ step: label, input: "keyboard typing", value }); }
  try {
    const f = await fixture(page, server);
    const agent = await report(server, "/agents", { displayName: "Synthetic keyboard tracking producer", source: "public keyboard fixture", defaultRole: "implementation" });
    const longMessage = "Keyboard full report " + "Full stored message remains available through native details. ".repeat(8);
    for (let i = 0; i < 22; i++) {
      const task = (await report(server, `/tasks/${f.task.id}`)).task;
      const id = randomUUID();
      await report(server, "/runs", { id, projectId: f.project.id, taskId: f.task.id, agentId: agent.id, purpose: "verification", expectedTaskVersion: task.version });
      await event(server, id, 1, "run.started");
      if (i === 0) await event(server, id, 2, "run.progress", { message: longMessage });
      await event(server, id, i === 0 ? 3 : 2, "run.succeeded", { summary: `Synthetic stored verification ${i}` });
    }
    const task = (await report(server, `/tasks/${f.task.id}`)).task;
    const activeId = randomUUID();
    await report(server, "/runs", { id: activeId, projectId: f.project.id, taskId: f.task.id, agentId: agent.id, purpose: "implementation", expectedTaskVersion: task.version });
    await event(server, activeId, 1, "run.started");
    const dir = server.dir, port = server.port; await server.stop();
    const db = new Database(join(dir, "agentflow.sqlite")); db.prepare("UPDATE runs SET last_received_at=? WHERE id=?").run(Date.now() - 120000, activeId); db.close();
    server = await launch({ dir, port });
    await page.goto(server.url);
    await activate(page.getByRole("link", { name: "Agents", exact: true }), "Agents navigation");
    await activate(page.getByRole("link", { name: agent.displayName, exact: true }), "Agent identity");
    await activate(page.getByRole("link", { name: `implementation · ${agent.displayName}`, exact: true }), "Reported attempt");
    await expect(page.locator(".run-detail .report-label")).toHaveText("running · Stale report · execution uncertain");
    await activate(page.getByRole("link", { name: "Activity", exact: true }), "Activity navigation");
    await type(page.getByLabel("Task UUID", { exact: true }), "Activity task filter", f.task.id);
    await activate(page.getByRole("button", { name: "Apply filters", exact: true }), "Apply Activity filters");
    await expect(page).toHaveURL(new RegExp(`taskId=${f.task.id}`));
    await expect(page.locator(".activity-list > li")).toHaveCount(30);
    await activate(page.getByRole("button", { name: "Load more activity", exact: true }), "Load stored activity page");
    await expect(page.locator(".activity-list > li")).toHaveCount(46);
    const summary = page.locator(".activity-list summary").filter({ hasText: "Keyboard full report" });
    await activate(summary, "Expand full reported message", "Space");
    await expect(summary.locator("..")).toHaveAttribute("open", "");
    await expect(summary.locator("..").locator("p")).toHaveText(longMessage);
    await page.keyboard.press("Space"); steps.push({ step: "Collapse full reported message", activation: "Space" });
    await expect(summary.locator("..")).not.toHaveAttribute("open", "");
    await activate(page.getByRole("link", { name: f.task.title, exact: true }).first(), "Task from stored activity");
    await activate(page.getByRole("button", { name: `implementation · ${agent.displayName}`, exact: true }), "Inline reported attempt");
    await activate(page.getByRole("button", { name: "Close stale tracking", exact: true }), "Begin stale tracking closure");
    const reason = page.getByRole("textbox", { name: "Reason", exact: true });
    await type(reason, "Required closure reason", "Synthetic keyboard closure keeps external execution uncertain");
    const before = await reason.evaluate(el => ({ focused: el === document.activeElement, focusVisible: el.matches(":focus-visible"), value: (el as HTMLTextAreaElement).value }));
    const refresh = page.waitForResponse(response => response.url().includes(`/api/v1/tracking/runs/${activeId}`) && response.request().method() === "GET");
    await report(server, "/agents", { displayName: "Synthetic unrelated refresh producer", source: "public keyboard fixture", defaultRole: "implementation" });
    await refresh;
    await expect(reason).toBeFocused(); await expect(reason).toHaveValue(before.value);
    const after = await reason.evaluate(el => ({ focused: el === document.activeElement, focusVisible: el.matches(":focus-visible"), value: (el as HTMLTextAreaElement).value }));
    expect(after).toEqual(before); steps.push({ step: "Background public change refresh", before, after });
    await activate(page.getByRole("button", { name: "Confirm tracking closure", exact: true }), "Confirm synthetic tracking closure");
    await expect(page.getByText("Tracking record closed. No process signal was sent.", { exact: true })).toBeVisible();
    await expect(page.locator(".run-detail .report-label")).toHaveText("interrupted · Terminal record");
    mkdirSync("work/poteto/P05", { recursive: true });
    writeFileSync("work/poteto/P05/keyboard-proof.json", JSON.stringify({ synthetic: true, qualification: "Actual public API/production Chrome keyboard navigation and activation, not human attestation; stale fixture aged while stopped, not silence proof", steps }, null, 2));
  } finally { await page.close(); await server.stop(); }
});
