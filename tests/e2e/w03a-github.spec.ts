import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { launch } from "../fixtures/server";
import { pairPage } from "../fixtures/p03";

test("explicit GitHub settings stay local until a selected manual refresh", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "w03a-ui-"));
  const credential = join(dir, "credential.json");
  writeFileSync(credential, JSON.stringify({ token: "SYNTHETIC_UI_TOKEN" }), { mode: 0o600 });
  let calls = 0;
  const remote = createServer((req, res) => {
    calls++;
    expect(req.method).toBe("GET");
    res.end(JSON.stringify([{ number: 9, html_url: "https://github.com/a/b/pull/9", title: "Synthetic private PR", state: "open", draft: false, head: { sha: "a".repeat(40) }, base: { ref: "main" }, merged_at: null }]));
  });
  await new Promise<void>(resolve => remote.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(remote.address() as { port: number }).port}`;
  const server = await launch({ dir: join(dir, "data"), entry: "tests/fixtures/w03a-server.ts", extraEnv: { AGENTFLOW_GITHUB_TOKEN_FILE: credential, W03A_FIXTURE_ORIGIN: origin } });
  try {
    await pairPage(page, server);
    await page.goto(server.url + "/settings");
    await expect(page.getByRole("heading", { name: "GitHub PR observations", exact: true })).toBeVisible();
    expect(calls).toBe(0);
    await page.getByLabel("Enable read-only GitHub observations", { exact: true }).check();
    await page.getByLabel("Selected repositories", { exact: true }).fill("a/b");
    await page.getByRole("button", { name: "Save GitHub selection", exact: true }).click();
    await expect(page.getByText("GitHub selection saved.", { exact: true })).toBeVisible();
    expect(calls).toBe(0);
    await page.getByRole("button", { name: "Fetch GitHub metadata", exact: true }).click();
    await expect(page.getByText("Synthetic private PR", { exact: true })).toBeVisible();
    expect(calls).toBe(1);
  } finally {
    await server.stop();
    await new Promise<void>(resolve => { remote.close(() => resolve()); remote.closeAllConnections(); });
  }
});
