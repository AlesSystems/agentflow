import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { launch } from "../fixtures/server";
import { pairPage } from "../fixtures/p03";
import { reportedWorkflow } from "../fixtures/w01-producer";
test("real CLI branching workflow renders bound graph and equivalent list without inferring missing skill", async ({
  page,
  browser,
}) => {
  const server = await launch(),
    other = await browser.newContext();
  try {
    const f = await reportedWorkflow(server),
      second = await other.newPage();
    await pairPage(page, server);
    await pairPage(second, server);
    await page.goto(f.url);
    await second.goto(f.url);
    for (const tab of [page, second]) {
      await expect(
        tab.getByRole("heading", { name: "Workflows", exact: true }),
      ).toBeVisible();
      await expect(
        tab.getByRole("heading", { name: "Verify the change", exact: true }),
      ).toBeVisible();
      await expect(
        tab.getByText(f.verificationReport.eventId, { exact: true }),
      ).toBeVisible();
      await expect(
        tab.getByText("Skill Unknown", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        tab.getByRole("link", { name: "Open linked task", exact: true }),
      ).toHaveAttribute("href", new RegExp(f.taskId));
    }
    await page.getByRole("button", { name: "List", exact: true }).click();
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
    await f.report("workflow.succeeded", {
      summary: "Synthetic workflow outcome only",
    });
    await expect(
      second.getByText("succeeded · Terminal record", { exact: true }).first(),
    ).toBeVisible();
    const linkedTask = await second.evaluate(
      async (id) =>
        (await (await fetch(`/api/v1/tasks/${id}`)).json()).data.task,
      f.taskId,
    );
    expect(linkedTask.status).toBe("review");
    await expect(
      page.getByText("No node observation received.", { exact: true }),
    ).toBeVisible();
  } finally {
    await other.close();
    await server.stop();
  }
});
test("workflow navigation restores exact selection and display-only graph rejects edits", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await reportedWorkflow(server);
    await pairPage(page, server);
    await page.goto(f.url);
    await expect(
      page.getByRole("heading", { name: "Verify the change", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".react-flow__controls-interactive")).toHaveCount(
      0,
    );
    const graphNode = page.locator(
      `.react-flow__node[data-id="${f.verificationNodeId}"]`,
    );
    await graphNode.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Verify the change", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Delete");
    await expect(page.locator(".react-flow__node")).toHaveCount(3);
    await page
      .getByRole("link", { name: "Open linked task", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Back to workflow", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Verify the change", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(f.verificationNodeId));
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Verify the change · running",
        exact: true,
      }),
    ).toBeFocused();
    await page
      .getByRole("button", {
        name: "Build the change · succeeded",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Skill Test-driven development", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Source synthetic://inert-skill · Version 1", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator('a[href="synthetic://inert-skill"]')).toHaveCount(
      0,
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Build the change", exact: true }),
    ).toBeVisible();
  } finally {
    await server.stop();
  }
});
test("revision one evidence remains bound after revision two and server restart", async ({
  page,
}) => {
  let server = await launch();
  try {
    const f = await reportedWorkflow(server);
    await pairPage(page, server);
    await page.goto(f.url);
    await expect(
      page.getByText(f.verificationReport.eventId, { exact: true }),
    ).toBeVisible();
    await f.register(
      ["register", "workflow-revision", "--workflow", f.workflowId],
      {
        id: crypto.randomUUID(),
        expectedWorkflowVersion: 2,
        nodes: f.nodes.map((n) => ({ ...n, label: "Revision two " + n.label })),
        edges: [],
      },
    );
    await expect(
      page.getByRole("heading", { name: "Verify the change", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(f.verificationReport.eventId, { exact: true }),
    ).toBeVisible();
    const { dir, port } = server;
    await server.stop();
    server = await launch({ dir, port });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Verify the change", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(f.verificationReport.eventId, { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(f.revisionId));
  } finally {
    await server.stop();
  }
});
test("offline CLI observation is delivered after restart with missing fields remaining Unknown", async ({
  page,
}) => {
  let server = await launch();
  try {
    const f = await reportedWorkflow(server);
    await pairPage(page, server);
    await page.goto(f.url);
    const { dir, port } = server;
    await server.stop();
    const result = await f.cli([
      "report",
      "--workflow-run",
      f.workflowRunId,
      "--type",
      "workflow.node.reported",
      "--payload",
      f.file({ nodeId: f.implementationNodeId, state: "running" }),
    ]);
    expect(result.code).toBe(2);
    server = await launch({ dir, port });
    const flushed = await f.cli(["flush", "--workflow-run", f.workflowRunId]);
    expect(flushed.code).toBe(0);
    await page.reload();
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page
      .getByRole("button", { name: "Build the change · running", exact: true })
      .click();
    await expect(
      page.getByText("Skill Unknown", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Linked attempt Unknown", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open reported attempt", exact: true }),
    ).toHaveCount(0);
  } finally {
    await server.stop();
  }
});
test("elapsed time makes workflow and linked attempt stale without another write", async ({
  page,
}) => {
  test.setTimeout(100000);
  const server = await launch();
  try {
    const f = await reportedWorkflow(server);
    await pairPage(page, server);
    await page.goto(f.url);
    await expect(
      page.getByText("running · Fresh report", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("running · Stale report · execution uncertain", {
        exact: true,
      }),
    ).toHaveCount(2, { timeout: 85000 });
    await expect(
      page.getByRole("button", {
        name: "Close stale workflow tracking",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Close stale workflow tracking",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Synthetic operator closure evidence");
    await page
      .getByRole("button", {
        name: "Confirm workflow tracking closure",
        exact: true,
      })
      .click();
    await expect(
      page.getByText("interrupted · Terminal record", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Operator closed tracking: Synthetic operator closure evidence",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText("running · Stale report · execution uncertain", {
        exact: true,
      }),
    ).toHaveCount(1);
  } finally {
    await server.stop();
  }
});
test("reported skill markup stays inert and a missing later skill does not inherit", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await reportedWorkflow(server);
    await pairPage(page, server);
    await page.goto(f.url);
    await f.report("workflow.node.reported", {
      nodeId: f.verificationNodeId,
      state: "running",
      reportedSkill: {
        name: '<img src=x onerror="window.w01Injected=true">',
        source: "javascript:window.w01Injected=true",
        version: "<script>bad</script>",
      },
    });
    await expect(
      page.getByText('Skill <img src=x onerror="window.w01Injected=true">', {
        exact: true,
      }),
    ).toBeVisible();
    expect(await page.evaluate(() => "w01Injected" in window)).toBe(false);
    await expect(
      page.locator(
        '.workflow-evidence img,.workflow-evidence script,a[href^="javascript:"]',
      ),
    ).toHaveCount(0);
    await f.report("workflow.node.reported", {
      nodeId: f.verificationNodeId,
      state: "running",
    });
    await expect(
      page.getByText("Skill Unknown", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Linked attempt Unknown", { exact: true }),
    ).toBeVisible();
  } finally {
    await server.stop();
  }
});
test("batched workflow visual evidence", async ({ page }) => {
  test.skip(
    !process.env.AGENTFLOW_W01_VISUAL_DIR,
    "explicit owned visual round only",
  );
  const server = await launch();
  try {
    const f = await reportedWorkflow(server);
    await pairPage(page, server);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(f.url);
    await expect(
      page.getByText(f.verificationReport.eventId, { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: process.env.AGENTFLOW_W01_VISUAL_DIR + "/desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Verify the change · running",
        exact: true,
      }),
    ).toBeFocused();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: process.env.AGENTFLOW_W01_VISUAL_DIR + "/narrow.png",
      fullPage: true,
    });
  } finally {
    await server.stop();
  }
});
test("skip link remains outside the viewport after selecting a narrow plan node", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await reportedWorkflow(server);
    await pairPage(page, server);
    await page.goto(f.url);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Verify the change · running",
        exact: true,
      }),
    ).toBeFocused();
    const fact = await page.locator(".skip-link").evaluate((element) => ({
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
      focused: document.activeElement === element,
      scrollY: window.scrollY,
      cssTop: getComputedStyle(element).top,
    }));
    expect(fact.focused).toBe(false);
    expect(fact.bottom).toBeLessThanOrEqual(0);
    console.log(JSON.stringify({ proof: "real viewport skip link", ...fact }));
  } finally {
    await server.stop();
  }
});

test("two workflow contexts retain bound selection and clear discarded evidence after restored generation", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  let server = await launch();
  const other = await browser.newContext();
  try {
    const f = await reportedWorkflow(server),
      second = await other.newPage();
    for (const tab of [page, second]) {
      await pairPage(tab, server);
      await tab.goto(f.url);
      await expect(
        tab.getByText(f.verificationReport.eventId, { exact: true }),
      ).toBeVisible();
    }
    const originalUrl = page.url(),
      oldGeneration = await page.evaluate(
        async () =>
          (await (await fetch("/api/v1/overview?timezone=UTC")).json())
            .generation,
      ),
      { dir, port } = server,
      backup = join(f.dir, "workflow-generation.sqlite"),
      env = { ...process.env, AGENTFLOW_DATA_DIR: dir, PORT: String(port) };
    await server.stop();
    const backupOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/cli/local.ts", "backup", "--output", backup],
      { env, encoding: "utf8" },
    );
    expect(backupOutput).toContain("Integrity ok");
    server = await launch({ dir, port });
    await f.report("workflow.succeeded", {
      summary: "Post-backup outcome discarded by restore",
    });
    const revision2 = await f.register(
        ["register", "workflow-revision", "--workflow", f.workflowId],
        {
          id: crypto.randomUUID(),
          expectedWorkflowVersion: 2,
          nodes: [
            {
              id: f.verificationNodeId,
              label: "Later verification evidence",
              taskId: f.taskId,
            },
          ],
          edges: [],
        },
      ),
      run2 = await f.register(["register", "workflow-run"], {
        id: crypto.randomUUID(),
        workflowId: f.workflowId,
        planRevisionId: revision2,
      });
    expect(
      (
        await f.cli([
          "report",
          "--workflow-run",
          run2,
          "--type",
          "workflow.started",
          "--payload",
          f.file({}),
        ])
      ).code,
    ).toBe(0);
    const later = await f.cli([
      "report",
      "--workflow-run",
      run2,
      "--type",
      "workflow.node.reported",
      "--payload",
      f.file({
        nodeId: f.verificationNodeId,
        state: "running",
        reportedSkill: { name: "Discarded later skill" },
      }),
    ]);
    expect(later.code).toBe(0);
    const laterEvent = JSON.parse(later.stdout).eventId;
    await second
      .getByLabel("Plan revision", { exact: true })
      .selectOption(revision2);
    await expect(
      second.getByRole("heading", {
        name: "Later verification evidence",
        exact: true,
      }),
    ).toBeVisible();
    await expect(second.getByText(laterEvent, { exact: true })).toBeVisible();
    await expect(second).toHaveURL(new RegExp(run2));
    await server.stop();
    const restoreOutput = execFileSync(
      process.execPath,
      ["--import", "tsx", "src/cli/local.ts", "restore", "--from", backup],
      { env, encoding: "utf8" },
    );
    expect(restoreOutput).toContain("Browser sessions were revoked");
    server = await launch({ dir, port });
    for (const tab of [page, second]) {
      await expect(
        tab.getByRole("heading", { name: "Pair again to keep editing" }),
      ).toBeVisible({ timeout: 20000 });
      await tab
        .getByLabel("Pairing token", { exact: true })
        .fill(server.credentials().pairingToken);
      await tab
        .getByRole("button", { name: "Pair this browser", exact: true })
        .click();
      await expect(
        tab.getByText("Connected updates", { exact: true }),
      ).toBeVisible({ timeout: 15000 });
      const generation = await tab.evaluate(
        async () =>
          (await (await fetch("/api/v1/overview?timezone=UTC")).json())
            .generation,
      );
      expect(generation).not.toBe(oldGeneration);
    }
    await expect(page).toHaveURL(originalUrl);
    await expect(
      page.getByText(f.verificationReport.eventId, { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".workflow-evidence")).toHaveAttribute(
      "data-workflow-id",
      f.workflowId,
    );
    await expect(page.locator(".workflow-evidence")).toHaveAttribute(
      "data-plan-revision-id",
      f.revisionId,
    );
    await expect(page.locator(".workflow-evidence")).toHaveAttribute(
      "data-workflow-run-id",
      f.workflowRunId,
    );
    await expect(page.locator(".workflow-evidence")).toHaveAttribute(
      "data-node-id",
      f.verificationNodeId,
    );
    await expect(second).toHaveURL(new RegExp(revision2));
    await expect(second).toHaveURL(new RegExp(run2));
    await expect(second).toHaveURL(new RegExp(f.verificationNodeId));
    await expect(second.getByText(laterEvent, { exact: true })).toHaveCount(0);
    await expect(
      second.getByRole("heading", {
        name: "Later verification evidence",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      second
        .getByText("This record is unavailable. Return to Projects.", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await second
      .getByLabel("Plan revision", { exact: true })
      .selectOption(f.revisionId);
    await expect(
      second.getByText(f.verificationReport.eventId, { exact: true }),
    ).toBeVisible();
    await expect(second.locator(".workflow-evidence")).toHaveAttribute(
      "data-workflow-run-id",
      f.workflowRunId,
    );
    await expect(second.locator(".workflow-evidence")).toHaveAttribute(
      "data-node-id",
      f.verificationNodeId,
    );
    console.log(
      JSON.stringify({
        proof: "two-context workflow restored generation",
        tabs: 2,
        oldGeneration,
        restoredIds: {
          workflowId: f.workflowId,
          revisionId: f.revisionId,
          workflowRunId: f.workflowRunId,
          nodeId: f.verificationNodeId,
          eventId: f.verificationReport.eventId,
        },
        discardedIds: {
          revisionId: revision2,
          workflowRunId: run2,
          eventId: laterEvent,
        },
      }),
    );
  } finally {
    await other.close();
    await server.stop();
  }
});
