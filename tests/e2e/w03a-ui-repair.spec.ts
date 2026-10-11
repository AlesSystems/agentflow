import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { githubBrowserFixture } from "../fixtures/w03a-browser";
import { pairPage, command } from "../fixtures/p03";
const proof = process.env.AGENTFLOW_W03A_REPAIR_EVIDENCE;

test("Settings exposes an unlinked exact PR beyond twenty rows and local repository paging", async ({ page }) => {
  const fixture = await githubBrowserFixture(), { server, state, wires } = fixture;
  state.fullPage = true;
  try {
    await pairPage(page, server); await page.goto(server.url + "/settings");
    await page.getByLabel("Enable read-only GitHub observations", { exact: true }).check();
    await page.getByLabel("Selected repositories", { exact: true }).fill("a/b\nc/d");
    await page.getByRole("button", { name: "Save GitHub selection", exact: true }).click();
    await expect(page.getByText("GitHub selection saved.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Fetch GitHub metadata", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Synthetic a/b PR 20", exact: true })).toBeVisible();
    expect(wires).toHaveLength(1);
    await page.getByRole("combobox", { name: "Fetch target", exact: true }).selectOption("number");
    await page.getByLabel("PR number", { exact: true }).fill("99");
    await page.getByRole("button", { name: "Fetch GitHub metadata", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Synthetic a/b PR 99", exact: true })).toBeVisible();
    expect(wires).toHaveLength(2);
    await page.getByRole("button", { name: "Refresh saved observations", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Synthetic a/b PR 99", exact: true })).toBeVisible();
    expect(wires).toHaveLength(2);
    if (proof) { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: join(proof, "settings-desktop.png"), fullPage: true, animations: "disabled" }); }
    await page.setViewportSize({ width: 375, height: 812 }); await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Browse cached repository", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Synthetic a/b PR 20", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next cached page", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Synthetic a/b PR 99", exact: true })).toBeVisible();
    expect(wires).toHaveLength(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    if (proof) { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: join(proof, "settings-narrow.png"), fullPage: true, animations: "disabled" }); }
    await page.getByRole("combobox", { name: "Repository to observe", exact: true }).selectOption("c/d");
    await page.getByRole("button", { name: "Fetch GitHub metadata", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Synthetic c/d PR 99", exact: true })).toBeVisible();
    expect(wires).toHaveLength(3);
    state.status = 404;
    await page.getByLabel("PR number", { exact: true }).fill("100");
    await page.getByRole("button", { name: "Fetch GitHub metadata", exact: true }).click();
    await expect(page.getByText("No cached observation for c/d #100.", { exact: true })).toBeVisible();
    await expect(page.locator(".github-saved-observations").getByText(/This PR is unavailable.*Last attempted:/)).toBeVisible();
    expect(wires).toHaveLength(4);
    if (proof) writeFileSync(join(proof, "requested-metadata.json"), JSON.stringify({ wires, noLinkedTaskCreated: true, syntheticDataDir: fixture.dir }, null, 2), { mode: 0o600 });
  } finally { await fixture.stop(); }
});

test("only canonical selected task PR has a keyboard-openable safe external link", async ({ page }) => {
  const fixture = await githubBrowserFixture(), { server, wires } = fixture;
  try {
    await pairPage(page, server);
    await command(page, "/connections/github/repositories", { expectedVersion: 1, enabled: true, repositories: ["a/b"] }, "PUT");
    const project = await command(page, "/projects", { name: "Synthetic link regression" });
    const task = await command(page, "/tasks", { projectId: project.body.data.id, title: "Selected PR link", pullRequestUrl: "https://github.com/a/b/pull/9" });
    await page.goto(server.url + `/projects/${project.body.data.id}/tasks/${task.body.data.id}`);
    const link = page.getByRole("link", { name: "Open pull request", exact: true });
    await expect(link).toHaveAttribute("href", "https://github.com/a/b/pull/9");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await link.focus(); await expect(link).toBeFocused();
    await page.context().route("https://github.com/a/b/pull/9", route => route.fulfill({ contentType: "text/html", body: "<h1>Synthetic intercepted PR destination</h1>" }));
    const popupPromise = page.waitForEvent("popup"); await page.keyboard.press("Enter");
    const popup = await popupPromise; await expect(popup.getByRole("heading", { name: "Synthetic intercepted PR destination" })).toBeVisible(); await popup.close();
    expect(wires).toHaveLength(0);
    await command(page, "/connections/github/repositories", { expectedVersion: 2, enabled: true, repositories: ["c/d"] }, "PUT");
    await expect(link).toHaveCount(0);
    await expect(page.getByText(/This repository is not selected/)).toBeVisible();
    expect(wires).toHaveLength(0);
  } finally { await fixture.stop(); }
});
