import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { launch } from "../fixtures/server";
import { pairPage } from "../fixtures/p03";
import { reportedWorkflow } from "../fixtures/w01-producer";
test("375px complete list and evidence preserve accessible controls and inert reported skill", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await reportedWorkflow(server);
    await pairPage(page, server);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(f.url);
    await expect(
      page.getByRole("button", { name: "List", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", {
        name: "Unreported follow-up · Unknown",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Unreported follow-up · Unknown",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("No node observation received.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Graph", exact: true }).click();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Graph", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(
      page.getByText("No node observation received.", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    for (const label of ["Workflow", "Plan revision", "Workflow attempt"]) {
      const box = await page.getByLabel(label, { exact: true }).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    for (const name of ["Board", "Workflows"]) {
      const box = await page
        .getByRole("navigation", { name: "Project views" })
        .getByRole("link", { name, exact: true })
        .boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    for (const name of ["Graph", "List", "Unreported follow-up · Unknown"]) {
      const box = await page
        .getByRole("button", { name, exact: true })
        .boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await server.stop();
  }
});

test("actual Chrome profile 200 percent zoom reflows workflow evidence", async () => {
  const server = await launch(),
    browser = await chromium.launchPersistentContext(
      mkdtempSync(join(tmpdir(), "agentflow-w01-zoom-")),
      {
        channel: "chrome",
        headless: true,
        viewport: null,
        args: ["--window-size=1440,1000"],
      },
    ),
    page = await browser.newPage();
  try {
    const f = await reportedWorkflow(server);
    await pairPage(page, server);
    const before = await page.evaluate(() => ({
      width: innerWidth,
      dpr: devicePixelRatio,
    }));
    await page.goto("chrome://settings/appearance");
    await page.locator("select#zoomLevel").selectOption("2");
    await page.goto(f.url);
    const after = await page.evaluate(() => ({
      width: innerWidth,
      dpr: devicePixelRatio,
      cssZoom: getComputedStyle(document.body).zoom,
    }));
    expect(after.width).toBeLessThan(before.width * 0.6);
    expect(after.dpr).toBeGreaterThan(before.dpr * 1.9);
    expect(after.cssZoom).toBe("1");
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Verify the change", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    console.log(
      JSON.stringify({ proof: "native Chrome profile 200%", before, after }),
    );
  } finally {
    await browser.close();
    await server.stop();
  }
});
test("maximum bounded plan has a complete keyboard list with full long labels", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await reportedWorkflow(server),
      nodes = Array.from({ length: 100 }, (_, i) => ({
        id: crypto.randomUUID(),
        label: i === 0 ? "x".repeat(200) : `Synthetic bounded node ${i}`,
      }));
    const edges = [
      ...Array.from({ length: 99 }, (_, i) => ({
        source: nodes[i].id,
        target: nodes[i + 1].id,
      })),
      ...Array.from({ length: 98 }, (_, i) => ({
        source: nodes[i].id,
        target: nodes[i + 2].id,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        source: nodes[i].id,
        target: nodes[i + 3].id,
      })),
    ];
    const revisionId = await f.register(
      ["register", "workflow-revision", "--workflow", f.workflowId],
      { id: crypto.randomUUID(), expectedWorkflowVersion: 2, nodes, edges },
    );
    await pairPage(page, server);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(
      server.url +
        `/projects/${f.projectId}/workflows?workflowId=${f.workflowId}&revisionId=${revisionId}&view=list`,
    );
    const buttons = page.locator(".workflow-node-list button");
    await expect(buttons).toHaveCount(100);
    await buttons.first().focus();
    for (let i = 0; i < 100; i++) {
      await expect(buttons.nth(i)).toBeFocused();
      if (i < 99) await page.keyboard.press("Tab");
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(buttons.first()).toHaveText("x".repeat(200) + " · Unknown");
  } finally {
    await server.stop();
  }
});
