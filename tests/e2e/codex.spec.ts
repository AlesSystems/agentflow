import { test, expect } from "@playwright/test";
import { launch } from "../fixtures/server";
import { pairPage } from "../fixtures/p03";
const connection = { state: "connected", observedAt: "2026-10-13T10:00:00.000Z", message: null };
const chat = { id: "synthetic-chat", title: "Synthetic connector feature", cwd: "/synthetic/project", updatedAt: "2026-10-13T10:00:00.000Z", parentId: null, agentNickname: null, agentRole: null, model: "synthetic-model", status: "unknown", statusSource: "stored", archived: false };
const child = { ...chat, id: "synthetic-agent", title: "Synthetic review", parentId: chat.id, agentNickname: "Reviewer", agentRole: "reviewer" };
test("automatically lists chats and agents, preserves unknown progress and refreshes recorded tasks", async ({ page }) => {
  const server = await launch({ extraEnv: { AGENTFLOW_CODEX_EXECUTABLE: "/nonexistent/agentflow-codex-test" } });
  let update = "Synthetic initial update";
  let detailReads = 0;
  try {
    await pairPage(page, server);
    await page.route("**/api/v1/connections/codex**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/v1/connections/codex") {
        const data = url.searchParams.get("kind") === "agents" ? [child] : [chat];
        await route.fulfill({ json: { connection, data, nextCursor: null } });
      } else {
        detailReads++;
        const selected = url.pathname.endsWith(child.id) ? child : chat;
        await route.fulfill({ json: { connection, data: { chat: selected, agents: selected.parentId ? [] : [child], turns: [{ id: "synthetic-turn", status: "completed", startedAt: "2026-10-13T09:00:00.000Z", completedAt: "2026-10-13T10:00:00.000Z", request: "Build a synthetic connector", latestMessage: update, planText: null, tasks: [], progress: null }], nextTurnsCursor: null, nextAgentsCursor: null } } });
      }
    });
    await page.getByRole("link", { name: "View your Codex chats, tasks, and child agents" }).click();
    await expect(page.getByRole("heading", { name: "Codex", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Synthetic connector feature/ }).click();
    await expect(page.getByText("Build a synthetic connector", { exact: true })).toBeVisible();
    await expect(page.getByText("Checklist progress is unknown. Codex has no explicit checklist for this turn.")).toBeVisible();
    await expect(page.getByText("Synthetic initial update", { exact: true })).toBeVisible();
    update = "Synthetic refreshed update";
    await expect(page.getByText(update, { exact: true })).toBeVisible({ timeout: 12000 });
    expect(detailReads).toBeGreaterThan(1);
    await page.getByRole("combobox", { name: "Show", exact: true }).selectOption("agents");
    await expect(page.getByRole("button", { name: /Synthetic review/ })).toBeVisible();
    await page.getByRole("button", { name: "Reviewer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open parent chat", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open parent chat", exact: true }).click();
    await expect(page.getByRole("heading", { name: chat.title, exact: true })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await server.stop(); }
});
