import { test, expect } from "@playwright/test";
import { launch } from "../fixtures/server";
import { pairPage } from "../fixtures/p03";
const connection = { state: "connected", observedAt: "2026-10-13T10:00:00.000Z", message: null };
const session = { id: "synthetic-claude-session", title: "Synthetic connector feature", cwd: "/synthetic/project", updatedAt: "2026-10-13T10:00:00.000Z", parentId: null, agentNickname: null, agentRole: null, model: "synthetic-model", status: "running", statusSource: "live", archived: false };
const child = { ...session, id: "synthetic-agent", title: "Synthetic review", parentId: session.id, agentNickname: "Reviewer", agentRole: "reviewer" };
test("lists Claude sessions and subagents, shows checklist progress and refreshes recorded tasks", async ({ page }) => {
  const server = await launch({ extraEnv: { AGENTFLOW_CODEX_EXECUTABLE: "/nonexistent/agentflow-codex-test" } });
  let update = "Synthetic initial update";
  let detailReads = 0;
  try {
    await pairPage(page, server);
    await page.route("**/api/v1/connections/claude**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/v1/connections/claude") {
        const data = url.searchParams.get("kind") === "agents" ? [child] : [session];
        await route.fulfill({ json: { connection, data, nextCursor: null } });
      } else {
        detailReads++;
        const selected = url.pathname.endsWith(child.id) ? child : session;
        await route.fulfill({ json: { connection, data: { session: selected, agents: selected.parentId ? [] : [child], turns: [{ id: "synthetic-turn", status: "completed", startedAt: "2026-10-13T09:00:00.000Z", completedAt: "2026-10-13T10:00:00.000Z", request: "Build a synthetic connector", latestMessage: update, planText: null, tasks: [], progress: null }, { id: "synthetic-turn-2", status: "inProgress", startedAt: "2026-10-13T10:05:00.000Z", completedAt: null, request: "Synthetic checklist request", latestMessage: null, planText: null, tasks: [{ text: "Synthetic first step", status: "completed" }, { text: "Synthetic second step", status: "in_progress" }], progress: { completed: 1, total: 2, percent: 50 } }], nextTurnsCursor: null, nextAgentsCursor: null } } });
      }
    });
    await page.getByRole("link", { name: "View your Claude Code sessions, tasks, and subagents" }).click();
    await expect(page.getByRole("heading", { name: "Claude Code", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Synthetic connector feature/ }).click();
    await expect(page.getByText("Build a synthetic connector", { exact: true })).toBeVisible();
    await expect(page.getByText("Checklist progress is unknown. Claude recorded no task list for this turn.")).toBeVisible();
    await expect(page.getByText("1 of 2 checklist steps completed (50%).")).toBeVisible();
    await expect(page.getByText("Live observation · running").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Claude" })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /Show archived/ })).toHaveCount(0);
    await expect(page.getByText("Synthetic initial update", { exact: true })).toBeVisible();
    update = "Synthetic refreshed update";
    await expect(page.getByText(update, { exact: true })).toBeVisible({ timeout: 12000 });
    expect(detailReads).toBeGreaterThan(1);
    await page.getByRole("combobox", { name: "Show", exact: true }).selectOption("agents");
    await expect(page.getByRole("button", { name: /Synthetic review/ })).toBeVisible();
    await page.getByRole("button", { name: "Reviewer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open parent session", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open parent session", exact: true }).click();
    await expect(page.getByRole("heading", { name: session.title, exact: true })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await server.stop(); }
});
