import { test, expect, chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "../fixtures/server";
import { fixture } from "../fixtures/p03";
async function axe(page: import("@playwright/test").Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}
test("board, task, settings and narrow layouts retain accessible controls", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await fixture(page, server);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(f.boardUrl);
    await axe(page);
    const contrast = await page.evaluate(() => {
      function rgb(value: string) {
        return (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      }
      function lum(values: number[]) {
        return values
          .map((v) => {
            const s = v / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      }
      const pairs = [
        { name: "body", element: document.body, background: document.body },
        {
          name: "metadata",
          element: document.querySelector(".metadata")!,
          background: document.body,
        },
        {
          name: "card title",
          element: document.querySelector(".card-title")!,
          background: document.querySelector(".task-card")!,
        },
        {
          name: "primary action",
          element: document.querySelector(".primary")!,
          background: document.querySelector(".primary")!,
        },
        ...[...document.querySelectorAll(".lane h2")].map((element) => ({
          name: element.textContent,
          element,
          background: element,
        })),
      ];
      return pairs.map((pair) => {
        const foreground = getComputedStyle(pair.element).color;
        const background = getComputedStyle(pair.background).backgroundColor;
        const a = lum(rgb(foreground)),
          b = lum(rgb(background));
        return {
          name: pair.name,
          foreground,
          background,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        };
      });
    });
    contrast.forEach((pair) => expect(pair.ratio).toBeGreaterThanOrEqual(4.5));
    mkdirSync("work/poteto/P03", { recursive: true });
    writeFileSync(
      "work/poteto/P03/contrast.json",
      JSON.stringify(contrast, null, 2),
    );
    await page.getByRole("button", { name: f.task.title, exact: true }).focus();
    await page.keyboard.press("Enter");
    await axe(page);
    await expect(
      page.getByRole("button", { name: "Close", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: f.task.title, exact: true }),
    ).toBeFocused();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByLabel("Show status")).toBeVisible();
    await axe(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await axe(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator(".dialog-overlay")
        .evaluate((e) => getComputedStyle(e).animationName),
    ).toBe("none");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await axe(page);
  } finally {
    await server.stop();
  }
});
test("actual Chrome profile zoom at 200 percent reflows the board", async () => {
  const server = await launch();
  const browser = await chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), "agentflow-zoom-")),
    {
      channel: "chrome",
      headless: true,
      viewport: null,
      args: ["--window-size=1440,1000"],
    },
  );
  const page = await browser.newPage();
  try {
    const f = await fixture(page, server);
    const before = await page.evaluate(() => ({
      width: innerWidth,
      dpr: devicePixelRatio,
    }));
    await page.goto("chrome://settings/appearance");
    const select = page.locator("select#zoomLevel");
    await expect(select).toBeVisible();
    await select.selectOption("2");
    await page.goto(f.boardUrl);
    const after = await page.evaluate(() => ({
      width: innerWidth,
      dpr: devicePixelRatio,
      cssZoom: getComputedStyle(document.body).zoom,
    }));
    mkdirSync("work/poteto/P03", { recursive: true });
    writeFileSync(
      "work/poteto/P03/native-zoom.json",
      JSON.stringify({ before, after }, null, 2),
    );
    console.log(
      JSON.stringify({
        proof: "native Chrome profile 200% zoom",
        before,
        after,
      }),
    );
    expect(after.width).toBeLessThan(before.width * 0.6);
    expect(after.dpr).toBeGreaterThan(before.dpr * 1.9);
    expect(after.cssZoom).toBe("1");
    await expect(page.getByLabel("Show status")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await axe(page);
  } finally {
    await browser.close();
    await server.stop();
  }
});
