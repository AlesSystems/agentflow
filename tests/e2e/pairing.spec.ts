import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { launch } from "../fixtures/server";

test("pairs with the keyboard and reads SQLite while external network is denied", async ({
  page,
  context,
}) => {
  const server = await launch();
  const requests: string[] = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    requests.push(url.origin);
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      return route.abort();
    return route.continue();
  });
  try {
    await page.goto(server.url + "/pair");
    await expect(
      page.getByRole("heading", { name: "Pair your browser" }),
    ).toBeVisible();
    await page.getByLabel("Pairing token", { exact: true }).fill("incorrect");
    await page.getByRole("button", { name: "Pair this browser" }).click();
    await expect(page.locator("#pairing-error")).toContainText("not accepted");
    await page
      .getByLabel("Pairing token", { exact: true })
      .fill(server.credentials().pairingToken);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Pair this browser" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Your local workspace is ready" }),
    ).toBeVisible();
    await expect(page.getByText("SQLite · ready")).toBeVisible();
    const metadata = await page.evaluate(async () => {
      const response = await fetch("/api/v1/foundation");
      return {
        status: response.status,
        body: await response.json(),
        generation: response.headers.get("AgentFlow-Generation"),
      };
    });
    expect(metadata.status).toBe(200);
    expect(metadata.body.generation).toBe(metadata.generation);
    mkdirSync(".impeccable/review/P01", { recursive: true });
    await page.screenshot({
      path: ".impeccable/review/P01/foundation.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({
      path: ".impeccable/review/P01/foundation-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => {
      document.body.style.zoom = "2";
    });
    await expect(
      page.getByRole("button", { name: "Disconnect browser" }),
    ).toBeVisible();
    expect(requests.every((origin) => origin === server.url)).toBe(true);
    await page.reload();
    await expect(page.getByText("SQLite · ready")).toBeVisible();
    await page.getByRole("button", { name: "Disconnect browser" }).click();
    await expect(
      page.getByRole("heading", { name: "Pair your browser" }),
    ).toBeVisible();
    await page.screenshot({
      path: ".impeccable/review/P01/pairing-mobile.png",
      fullPage: true,
    });
  } finally {
    await server.stop();
  }
});
test("a paired browser on a second localhost port cannot read pages, RSC or prefetch", async ({
  page,
}) => {
  const server = await launch();
  const other = createServer((_, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<html><body><a id="private" href="' +
        server.url +
        '">Private page</a></body></html>',
    );
  });
  await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
  const address = other.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await page.goto(server.url + "/pair");
    await page
      .getByLabel("Pairing token", { exact: true })
      .fill(server.credentials().pairingToken);
    await page.getByRole("button", { name: "Pair this browser" }).click();
    await expect(page.getByText("SQLite · ready")).toBeVisible();
    await page.goto(`http://127.0.0.1:${port}`);
    const session = await page.context().newCDPSession(page);
    await session.send("Network.enable");
    for (const path of ["/api/v1/foundation", "/?_rsc=synthetic"]) {
      let requestId = "";
      const response = new Promise<number>((resolve) => {
        session.on("Network.requestWillBeSent", (event) => {
          if (event.request.url === server.url + path)
            requestId = event.requestId;
        });
        session.on("Network.responseReceivedExtraInfo", (event) => {
          if (event.requestId === requestId) resolve(event.statusCode);
        });
      });
      await page.evaluate(
        ({ url, rsc }) => {
          void fetch(url, {
            credentials: "include",
            headers: rsc ? { RSC: "1", "Next-Router-Prefetch": "1" } : {},
          }).catch(() => undefined);
        },
        { url: server.url + path, rsc: path.startsWith("/?") },
      );
      expect(await response).toBe(403);
    }
    const response = await Promise.all([
      page.waitForResponse((response) => response.url() === server.url + "/"),
      page.locator("#private").click(),
    ]);
    expect(response[0].status()).toBe(403);
    await expect(page.getByText("SQLite · ready")).not.toBeVisible();
  } finally {
    await new Promise<void>((resolve) => other.close(() => resolve()));
    await server.stop();
  }
});
