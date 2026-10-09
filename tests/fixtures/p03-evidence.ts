import { chromium, expect } from "@playwright/test";
import { mkdirSync, copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import AxeBuilder from "@axe-core/playwright";
import { launch } from "./server";
import { fixture, command, pairPage } from "./p03";
const out = ".impeccable/review/P03";
mkdirSync(out, { recursive: true });
mkdirSync("work/poteto/P03", { recursive: true });
const server = await launch();
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: {
    dir: mkdtempSync(join(tmpdir(), "agentflow-p03-video-")),
    size: { width: 1440, height: 1000 },
  },
});
const page = await context.newPage();
await page.emulateMedia({ reducedMotion: "reduce" });
const secondContext = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const second = await secondContext.newPage();
const findings: unknown[] = [];
try {
  await context.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  const f = await fixture(page, server);
  for (const [title, status] of [
    ["Build the task editor", "in_progress"],
    ["Check conflict recovery", "review"],
    ["Verify restart persistence", "completed"],
  ] as const) {
    const task = (
      await command(page, "/tasks", {
        projectId: f.project.id,
        title,
        description: "Synthetic P03 evidence fixture",
        acceptanceCriteria:
          "Inspect the committed record and retained evidence.",
        priority: status === "review" ? "high" : "normal",
        tags: ["synthetic"],
      })
    ).body.data;
    if (status === "completed") {
      await command(
        page,
        `/tasks/${task.id}`,
        { expectedVersion: 1, status: "review" },
        "PATCH",
      );
      await command(page, `/tasks/${task.id}/complete`, {
        expectedVersion: 2,
        evidenceNote:
          "Synthetic browser acceptance fixture. No actual human attestation.",
      });
    } else
      await command(
        page,
        `/tasks/${task.id}`,
        { expectedVersion: 1, status },
        "PATCH",
      );
  }
  await page.goto(f.boardUrl);
  await expect(page.locator(".task-card")).toHaveCount(4);
  await page.screenshot({ path: out + "/board.png", fullPage: true });
  await page.getByRole("button", { name: f.task.title, exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toBeVisible();
  await page.screenshot({ path: out + "/task-panel.png", fullPage: true });
  await pairPage(second, server);
  await second.goto(f.boardUrl);
  await second.getByRole("button", { name: f.task.title, exact: true }).click();
  await second
    .getByLabel("Description", { exact: true })
    .fill("Retained draft from a second paired browser.");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Current saved text from the first browser.");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Changes saved." }),
  ).toBeVisible();
  await second.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    second.getByRole("heading", { name: "Current saved task" }),
  ).toBeVisible();
  await second.screenshot({ path: out + "/conflict.png", fullPage: true });
  findings.push({
    view: "conflict",
    axe: (
      await new AxeBuilder({ page: second })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const narrow = await context.newPage();
  await narrow.setViewportSize({ width: 375, height: 812 });
  await narrow.emulateMedia({ reducedMotion: "reduce" });
  await narrow.goto(f.boardUrl);
  await expect(narrow.getByLabel("Show status")).toBeVisible();
  await expect(
    narrow.getByRole("button", { name: f.task.title, exact: true }),
  ).toBeVisible();
  await narrow.screenshot({ path: out + "/narrow.png", fullPage: true });
  await narrow.getByRole("button", { name: f.task.title, exact: true }).click();
  await expect(narrow.getByLabel("Title", { exact: true })).toBeVisible();
  await narrow.screenshot({ path: out + "/narrow-task.png", fullPage: true });
  await narrow.getByRole("button", { name: "Close", exact: true }).click();
  await narrow.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    narrow.getByRole("heading", { name: "Storage on this machine" }),
  ).toBeVisible();
  await narrow.screenshot({ path: out + "/settings.png", fullPage: true });
  const colors = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      [
        "--ink",
        "--muted",
        "--paper",
        "--canvas",
        "--action",
        "--backlog",
        "--progress",
        "--review",
        "--completed",
        "--attention",
        "--attention-tint",
      ].map((key) => [key, root.getPropertyValue(key).trim()]),
    );
  });
  findings.push({ actualComputedTokens: colors });
  writeFileSync(
    "work/poteto/P03/capture-state.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        fixture:
          "Synthetic records and synthetic browser acceptance. No actual human attestation.",
        captures: [
          "board",
          "task-panel",
          "conflict",
          "narrow",
          "narrow-task",
          "settings",
        ],
        findings,
      },
      null,
      2,
    ),
  );
} finally {
  await secondContext.close();
  await context.close();
  const video = await page.video()?.path();
  if (video) copyFileSync(video, out + "/journey.webm");
  await browser.close();
  await server.stop();
}
console.log("P03 evidence batch captured; servers stopped.");
