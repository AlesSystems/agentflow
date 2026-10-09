import { chromium, expect } from "@playwright/test";
import { mkdtempSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./server";
const server = await launch();
const browser = await chromium.launch({ channel: "chrome", slowMo: 80 });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: {
    dir: mkdtempSync(join(tmpdir(), "agentflow-full-journey-")),
    size: { width: 1440, height: 1000 },
  },
});
const page = await context.newPage();
try {
  await page.goto(server.url + "/pair");
  await page
    .getByLabel("Pairing token", { exact: true })
    .fill(server.credentials().pairingToken);
  await page.getByRole("button", { name: "Pair this browser" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .first()
    .click();
  await page.getByLabel("Project name").fill("Synthetic recorded journey");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page
    .getByRole("link", { name: "Synthetic recorded journey", exact: true })
    .click();
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Verify the synthetic manual journey");
  await page
    .getByLabel("Acceptance criteria", { exact: true })
    .fill("Inspect committed records and retained history.");
  await page.getByRole("button", { name: "Create task in Backlog" }).click();
  await page
    .getByRole("button", {
      name: "Verify the synthetic manual journey",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Description", { exact: true })
    .fill("Synthetic fixture data, stored locally.");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Changes saved." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Move task", exact: true })
    .last()
    .click();
  await page.getByRole("menuitem", { name: "Review", exact: true }).click();
  await expect(page.locator(".task-context")).toContainText("Review");
  await page
    .getByLabel("Add a comment", { exact: true })
    .fill("Synthetic browser command exercise, not a human attestation.");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Comment added." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Move task", exact: true })
    .last()
    .click();
  await page.getByRole("menuitem", { name: "Completed", exact: true }).click();
  await page
    .getByLabel("Acceptance evidence note", { exact: true })
    .fill("Synthetic acceptance fixture tests the human-session boundary.");
  await page.getByRole("button", { name: "Complete current revision" }).click();
  await expect(page.locator(".task-context")).toContainText("Completed");
  await page.getByRole("button", { name: "Reopen task" }).click();
  await page
    .getByLabel("Reason for reopening")
    .fill("Synthetic follow-up preserves history.");
  await page.getByRole("button", { name: "Confirm reopen" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Verify the synthetic manual journey",
      exact: true,
    }),
  ).toBeFocused();
} finally {
  await context.close();
  const video = await page.video()?.path();
  if (video) {
    mkdirSync(".impeccable/review/P03", { recursive: true });
    copyFileSync(video, ".impeccable/review/P03/journey.webm");
  }
  await browser.close();
  await server.stop();
}
console.log("Recorded full synthetic manual journey; server stopped.");
