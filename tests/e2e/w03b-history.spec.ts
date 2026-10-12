import { test, expect } from "@playwright/test";
import { launch } from "../fixtures/server";
import { pairPage } from "../fixtures/p03";

test("history selection requires a deliberate preview before prune", async ({ page }) => {
  const server = await launch();
  try {
    await pairPage(page, server);
    await page.goto(server.url + "/settings");
    await expect(page.getByRole("heading", { name: "Export history", exact: true })).toBeVisible();
    await expect(page.getByText("All history is retained until you explicitly prune.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download selected history", exact: true })).toBeDisabled();
    await page.getByLabel("Tasks and protected facts", { exact: true }).check();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download selected history", exact: true }).click();
    expect(await (await download).failure()).toBeNull();
    await expect(page.getByRole("button", { name: "Confirm prune", exact: true })).toHaveCount(0);
    await page.getByLabel("UTC cutoff", { exact: true }).fill("1970-01-01T00:00:00.000Z");
    await page.getByRole("button", { name: "Preview prune", exact: true }).click();
    await expect(page.getByText("No eligible history before this cutoff. Everything is retained.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm prune", exact: true })).toHaveCount(0);
  } finally { await server.stop(); }
});
