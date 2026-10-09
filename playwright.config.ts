import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30000,
  workers: 1,
  use: {
    browserName: "chromium",
    channel:
      process.env.AGENTFLOW_TEST_BROWSER === "chrome" ? "chrome" : undefined,
    headless: true,
    trace: "off",
    video: "off",
  },
  reporter: "list",
  outputDir: "test-results",
});
