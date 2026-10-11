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
    await page
      .locator(`.react-flow__node[data-id="${f.verificationNodeId}"]`)
      .focus();
    await expect(
      page.locator(`.react-flow__node[data-id="${f.verificationNodeId}"]`),
    ).toBeFocused();
    await page.evaluate(() => {
      const events: unknown[] = [];
      Object.assign(window, { w01FocusProbe: events });
      const summary = (value: EventTarget | null) =>
        value instanceof Element
          ? {
              tag: value.tagName,
              nodeId:
                value
                  .closest(".react-flow__node[data-id],button[data-node-id]")
                  ?.getAttribute("data-id") ??
                value.getAttribute("data-node-id"),
              role: value.getAttribute("role"),
              dialog: !!value.closest('[role="dialog"]'),
              connected: value.isConnected,
              visibility: getComputedStyle(value).visibility,
              bounds: {
                width: value.getBoundingClientRect().width,
                height: value.getBoundingClientRect().height,
              },
              hasFocus: document.hasFocus(),
              activeSame: document.activeElement === value,
              replacementSame: value.matches(".react-flow__node[data-id]")
                ? document.querySelector(
                    `.react-flow__node[data-id="${value.getAttribute("data-id")}"]`,
                  ) === value
                : null,
              dialogs: Array.from(
                document.querySelectorAll('[role="dialog"]'),
              ).map((d) => ({
                visibility: getComputedStyle(d).visibility,
                connected: d.isConnected,
              })),
            }
          : null;
      for (const type of ["focusin", "focusout"])
        document.addEventListener(
          type,
          (event) => {
            if (events.length < 100)
              events.push({
                type,
                target: summary(event.target),
                related: summary((event as FocusEvent).relatedTarget),
                active: summary(document.activeElement),
              });
          },
          true,
        );
    });
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
    console.log(
      JSON.stringify({
        proof: "generation focus trace",
        events: await page.evaluate(() => Reflect.get(window, "w01FocusProbe")),
      }),
    );
    await expect(
      page.locator(`.react-flow__node[data-id="${f.verificationNodeId}"]`),
    ).toBeFocused();
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
test("uppercase project URL retains matching workflow evidence", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await reportedWorkflow(server);
    await pairPage(page, server);
    await page.goto(f.url.replace(f.projectId, f.projectId.toUpperCase()));
    await expect(
      page.getByRole("heading", { name: "Verify the change", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(f.verificationReport.eventId, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "This attempt belongs to another plan. Choose a matching attempt.",
        { exact: true },
      ),
    ).toHaveCount(0);
  } finally {
    await server.stop();
  }
});
test("legacy physical uppercase project and attempt bind through canonical workflow URLs", async ({
  page,
}) => {
  const { legacyWorkflow } = await import("../fixtures/w01-legacy"),
    f = await legacyWorkflow();
  try {
    await pairPage(page, f.server);
    await page.goto(f.url);
    await expect(
      page.getByRole("heading", {
        name: "Legacy linked evidence",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(f.eventId, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open reported attempt", exact: true }),
    ).toHaveAttribute("href", new RegExp(f.taskRunId.toLowerCase()));
    await expect(
      page.getByText(
        "This attempt belongs to another plan. Choose a matching attempt.",
        { exact: true },
      ),
    ).toHaveCount(0);
  } finally {
    await f.server.stop();
  }
});
test("a workflow selected under another project cannot expose its plan links", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await reportedWorkflow(server),
      otherProject = await f.register(["project", "create"], {
        name: "Synthetic other workflow project",
      });
    await pairPage(page, server);
    await page.goto(f.url.replace(f.projectId, otherProject));
    await expect(
      page.getByText(
        "This workflow belongs to another project. Choose a matching workflow.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Verify the change", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Open linked task", exact: true }),
    ).toHaveCount(0);
  } finally {
    await server.stop();
  }
});
test("local task and attempt returns restore selected node focus in both views", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await reportedWorkflow(server);
    await pairPage(page, server);
    for (const view of ["graph", "list"]) {
      for (const label of ["Open linked task", "Open reported attempt"]) {
        await page.goto(f.url + `&view=${view}`);
        await expect(
          page.getByRole("heading", { name: "Verify the change", exact: true }),
        ).toBeVisible();
        const selected =
          view === "graph"
            ? page.locator(
                `.react-flow__node[data-id="${f.verificationNodeId}"]`,
              )
            : page.locator(`button[data-node-id="${f.verificationNodeId}"]`);
        await selected.focus();
        await page.getByRole("link", { name: label, exact: true }).click();
        await page
          .getByRole("link", { name: "Back to workflow", exact: true })
          .click();
        await expect(selected).toBeFocused();
        await expect(
          page.getByRole("heading", { name: "Verify the change", exact: true }),
        ).toBeVisible();
      }
    }
  } finally {
    await server.stop();
  }
});

test("real report refresh preserves node focus and does not steal control focus", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await reportedWorkflow(server);
    await pairPage(page, server);
    await page.goto(f.url + "&focus=node");
    const selected = page.locator(
      `.react-flow__node[data-id="${f.verificationNodeId}"]`,
    );
    await expect(selected).toBeFocused();
    const control = page.getByRole("button", { name: "Graph", exact: true });
    await control.focus();
    const event = await f.report("workflow.node.reported", {
      nodeId: f.verificationNodeId,
      state: "running",
    });
    await expect(page.locator(".workflow-evidence")).toHaveAttribute(
      "data-event-id",
      event.eventId,
    );
    await expect(control).toBeFocused();
    await selected.focus();
    const next = await f.report("workflow.node.reported", {
      nodeId: f.unknownNodeId,
      state: "running",
    });
    await expect(
      page.getByText(new RegExp(` · Sequence ${next.acceptedSequence}$`)),
    ).toBeVisible();
    await expect(selected).toBeFocused();
  } finally {
    await server.stop();
  }
});
test("graph Space selects evidence and Escape restores the selected node", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await reportedWorkflow(server);
    await pairPage(page, server);
    await page.goto(f.url);
    const node = page.locator(
      `.react-flow__node[data-id="${f.implementationNodeId}"]`,
    );
    await expect(node).toBeVisible();
    expect(
      await node.evaluate((element) => ({
        width: (element as HTMLElement).offsetWidth,
        height: (element as HTMLElement).offsetHeight,
      })),
    ).toEqual({ width: 230, height: 104 });
    await page.evaluate(() => {
      const events: unknown[] = [];
      Object.assign(window, { w01FocusProbe: events });
      for (const type of ["focusin", "focusout"])
        document.addEventListener(
          type,
          (event) => {
            if (events.length < 100) {
              const t = event.target as HTMLElement,
                r = (event as FocusEvent).relatedTarget as HTMLElement | null;
              events.push({
                type,
                target: t?.tagName,
                nodeId: t
                  ?.closest(".react-flow__node[data-id]")
                  ?.getAttribute("data-id"),
                related: r?.tagName,
                relatedNodeId: r
                  ?.closest(".react-flow__node[data-id]")
                  ?.getAttribute("data-id"),
              });
            }
          },
          true,
        );
    });
    await node.focus();
    console.log(
      JSON.stringify({
        proof: "Space focus trace",
        events: await page.evaluate(() => Reflect.get(window, "w01FocusProbe")),
      }),
    );
    console.log(
      JSON.stringify({
        proof: "Space target readiness",
        target: await node.evaluate((element) => ({
          connected: element.isConnected,
          tabIndex: (element as HTMLElement).tabIndex,
          visibility: getComputedStyle(element).visibility,
          display: getComputedStyle(element).display,
          box: {
            width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height,
          },
          activeTag: document.activeElement?.tagName,
          activeNode: document.activeElement?.getAttribute("data-id"),
          hasFocus: document.hasFocus(),
          inert: !!element.closest("[inert]"),
          dialogs: document.querySelectorAll('[role="dialog"]').length,
        })),
      }),
    );
    await expect(node).toBeFocused();
    await page.keyboard.press("Space");
    await expect(
      page.getByRole("heading", { name: "Build the change", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Open linked task", exact: true })
      .focus();
    await page.keyboard.press("Escape");
    await expect(node).toBeFocused();
  } finally {
    await server.stop();
  }
});
test("distinct historical node attempts remain reachable after a missing-run observation", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await reportedWorkflow(server),
      later = await f.report("workflow.node.reported", {
        nodeId: f.implementationNodeId,
        runId: f.verificationRunId,
        state: "running",
        reportedSkill: { name: "Synthetic verification skill" },
      });
    await f.report("workflow.node.reported", {
      nodeId: f.implementationNodeId,
      state: "pending",
    });
    await pairPage(page, server);
    await page.goto(
      f.url.replace(f.verificationNodeId, f.implementationNodeId) +
        "&view=list",
    );
    await expect(
      page.getByText("Linked attempt Unknown", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open reported attempt", exact: true }),
    ).toHaveCount(0);
    for (const [eventId, runId, purpose] of [
      [f.implementationReport.eventId, f.implementationRunId, "implementation"],
      [later.eventId, f.verificationRunId, "verification"],
    ]) {
      const row = page
          .locator(".workflow-evidence li")
          .filter({ hasText: `Report ${eventId}` }),
        link = row.getByRole("link", {
          name: "Open historical attempt",
          exact: true,
        });
      await expect(link).toHaveAttribute(
        "href",
        new RegExp(`/runs/${runId}\\?`),
      );
      await link.click();
      await expect(
        page.getByRole("heading", {
          name: `${purpose} · Synthetic workflow producer`,
          exact: true,
        }),
      ).toBeVisible();
      const actual = await page.evaluate(
        async (id) =>
          (await (await fetch(`/api/v1/tracking/runs/${id}`)).json()).data,
        runId,
      );
      expect(actual.id).toBe(runId);
      expect(actual.purpose).toBe(purpose);
      await page
        .getByRole("link", { name: "Back to workflow", exact: true })
        .click();
      await expect(
        page.locator(`button[data-node-id="${f.implementationNodeId}"]`),
      ).toBeFocused();
      await expect(
        page.getByText("Linked attempt Unknown", { exact: true }),
      ).toBeVisible();
    }
    const historicalTask = page
      .locator(".workflow-evidence li")
      .filter({ hasText: `Report ${f.implementationReport.eventId}` })
      .getByRole("link", { name: "Open historical task", exact: true });
    await expect(historicalTask).toHaveAttribute(
      "href",
      new RegExp(`/tasks/${f.taskId}\\?`),
    );
    await historicalTask.click();
    await expect(
      page.getByRole("heading", { name: "Task details", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        async (id) =>
          (await (await fetch(`/api/v1/tasks/${id}`)).json()).data.task.id,
        f.taskId,
      ),
    ).toBe(f.taskId);
    await page
      .getByRole("link", { name: "Back to workflow", exact: true })
      .click();
    await expect(
      page.locator(`button[data-node-id="${f.implementationNodeId}"]`),
    ).toBeFocused();
  } finally {
    await server.stop();
  }
});
test("plan-only task nodes expose Unknown evidence and safe return without a fabricated attempt", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await reportedWorkflow(server),
      nodeId = crypto.randomUUID(),
      revisionId = await f.register(
        ["register", "workflow-revision", "--workflow", f.workflowId],
        {
          id: crypto.randomUUID(),
          expectedWorkflowVersion: 2,
          nodes: [
            {
              id: nodeId,
              label: "Planned work before a report",
              taskId: f.taskId,
            },
          ],
          edges: [],
        },
      );
    await pairPage(page, server);
    for (const view of ["graph", "list"]) {
      await page.goto(
        server.url +
          `/projects/${f.projectId}/workflows?workflowId=${f.workflowId}&revisionId=${revisionId}&nodeId=${nodeId}&view=${view}`,
      );
      await expect(
        page.getByRole("heading", {
          name: "Planned work before a report",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText("No node observation received.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Skill Unknown", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Linked attempt Unknown", { exact: true }),
      ).toBeVisible();
      expect(
        await page
          .locator(".workflow-evidence")
          .getAttribute("data-workflow-run-id"),
      ).toBeNull();
      expect(page.url()).not.toContain("workflowRunId=");
      await page
        .getByRole("link", { name: "Open linked task", exact: true })
        .click();
      const task = await page.evaluate(
        async (id) =>
          (await (await fetch(`/api/v1/tasks/${id}`)).json()).data.task,
        f.taskId,
      );
      expect(task.id).toBe(f.taskId);
      await page
        .getByRole("link", { name: "Back to workflow", exact: true })
        .click();
      const selected =
        view === "graph"
          ? page.locator(`.react-flow__node[data-id="${nodeId}"]`)
          : page.locator(`button[data-node-id="${nodeId}"]`);
      await expect(selected).toBeFocused();
      expect(page.url()).not.toContain("workflowRunId=");
      await expect(
        page.getByText("Skill Unknown", { exact: true }),
      ).toBeVisible();
    }
    const invalidContext = new URLSearchParams({
      workflowId: f.workflowId,
      revisionId,
      nodeId,
      workflowRunId: "not-a-uuid",
    });
    await page.goto(
      server.url +
        `/projects/${f.projectId}/tasks/${f.taskId}?workflowReturn=${encodeURIComponent(invalidContext.toString())}`,
    );
    await expect(
      page.getByRole("heading", {
        name: "Task details",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to workflow", exact: true }),
    ).toHaveCount(0);
  } finally {
    await server.stop();
  }
});

test("desktop graph pointer edits stay disabled while keyboard zoom and evidence remain usable under reduced motion", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await reportedWorkflow(server);
    await pairPage(page, server);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(f.url);
    const node = page.locator(
      `.react-flow__node[data-id="${f.verificationNodeId}"]`,
    );
    await expect(node).toBeVisible();
    await expect(node).toHaveAttribute("role", "group");
    await expect(node).toHaveAttribute("aria-roledescription", "node");
    await expect(node).toHaveAttribute("tabindex", "0");
    await expect(node).toHaveAttribute("aria-label", /Verify the change/);
    const transform = await node.getAttribute("style"),
      box = await node.boundingBox();
    if (!box) throw new Error("visible node bounds required");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 80,
      box.y + box.height / 2 + 50,
      { steps: 8 },
    );
    await page.mouse.up();
    expect(await node.getAttribute("style")).toBe(transform);
    await page.getByRole("button", { name: "Fit View", exact: true }).click();
    const handles = page.locator(".react-flow__handle"),
      source = handles.first(),
      target = handles.last();
    const from = await source.boundingBox(),
      to = await target.boundingBox();
    if (!from || !to) throw new Error("rendered graph handle bounds required");
    const edges = await page.locator(".react-flow__edge").count();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
    await expect(page.locator(".react-flow__edge")).toHaveCount(edges);
    await expect(page.locator(".react-flow__connection")).toHaveCount(0);
    await expect(page.locator(".react-flow__edgeupdater")).toHaveCount(0);
    await expect(page.locator(".react-flow__controls-interactive")).toHaveCount(
      0,
    );
    const viewport = page.locator(".react-flow__viewport");
    const zoom = page.getByRole("button", { name: "Zoom In", exact: true });
    await page.evaluate(() => {
      const facts: unknown[] = [];
      Object.assign(window, { w01ZoomFacts: facts });
      for (const type of ["keydown", "keyup", "click"])
        document.addEventListener(type, (event) => {
          const target = event.target as HTMLElement;
          facts.push({
            type,
            key: event instanceof KeyboardEvent ? event.key : null,
            prevented: event.defaultPrevented,
            label: target.getAttribute("aria-label"),
            tag: target.tagName,
            connected: target.isConnected,
            disabled:
              target instanceof HTMLButtonElement ? target.disabled : null,
            focused: target === document.activeElement,
            viewport: document
              .querySelector(".react-flow__viewport")
              ?.getAttribute("style"),
          });
        });
    });
    await zoom.evaluate((button) => {
      const facts = (window as unknown as { w01ZoomFacts: unknown[] })
        .w01ZoomFacts;
      new MutationObserver(() =>
        facts.push({
          type: "buttonMutation",
          disabled: (button as HTMLButtonElement).disabled,
          connected: button.isConnected,
          focused: button === document.activeElement,
          viewport: document
            .querySelector(".react-flow__viewport")
            ?.getAttribute("style"),
        }),
      ).observe(button, { attributes: true });
    });
    await expect(zoom).toBeEnabled();
    await zoom.focus();
    await expect(zoom).toBeFocused();
    const before = await viewport.getAttribute("style");
    await page.keyboard.down("Space");
    await expect
      .poll(() => zoom.evaluate((button) => button.matches(":active")))
      .toBe(true);
    await page.keyboard.up("Space");
    console.log(
      JSON.stringify(
        await page.evaluate(() => ({
          facts: (window as unknown as { w01ZoomFacts: unknown[] })
            .w01ZoomFacts,
          active: document.activeElement?.getAttribute("aria-label"),
          viewport: document
            .querySelector(".react-flow__viewport")
            ?.getAttribute("style"),
        })),
      ),
    );
    await expect(zoom).toBeFocused();
    if (!before) throw new Error("graph viewport transform required");
    await expect(viewport).not.toHaveAttribute("style", before);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Zoom Out", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Fit View", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await node.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Delete");
    await expect(page.locator(".react-flow__node")).toHaveCount(3);
    const evidence = page.getByRole("region", { name: "Node evidence" });
    await evidence
      .getByRole("button", { name: "Back to selected plan node", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    await expect(
      evidence.getByRole("link", { name: "Open linked task", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      evidence.getByRole("link", {
        name: "Open reported attempt",
        exact: true,
      }),
    ).toBeFocused();
    expect(
      await page.evaluate(() => ({
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
        graphAnimations:
          document
            .querySelector(".workflow-graph")
            ?.getAnimations({ subtree: true }).length ?? 0,
      })),
    ).toEqual({ reduced: true, graphAnimations: 0 });
  } finally {
    await server.stop();
  }
});
