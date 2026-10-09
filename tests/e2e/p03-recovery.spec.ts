import { test, expect } from "@playwright/test";
import { launch } from "../fixtures/server";
import { fixture, pairPage, command } from "../fixtures/p03";
test("independently paired browsers expose conflict and retain a draft through re-pairing", async ({
  page,
  browser,
}) => {
  const server = await launch();
  const other = await browser.newContext();
  const second = await other.newPage();
  try {
    const f = await fixture(page, server);
    await pairPage(second, server);
    await page.goto(f.boardUrl);
    await second.goto(f.boardUrl);
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await second
      .getByRole("button", { name: f.task.title, exact: true })
      .click();
    await page
      .getByLabel("Description", { exact: true })
      .fill("First browser saved");
    await second
      .getByLabel("Description", { exact: true })
      .fill("Second browser retained draft");
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Changes saved." }),
    ).toBeVisible();
    await second
      .getByRole("button", { name: "Save task", exact: true })
      .click();
    await expect(
      second.getByRole("heading", { name: "Current saved task" }),
    ).toBeVisible();
    await expect(second.getByLabel("Description", { exact: true })).toHaveValue(
      "Second browser retained draft",
    );
    await expect(
      second.getByText("First browser saved", { exact: true }),
    ).toBeVisible();
    await second.getByRole("button", { name: "Prepare reapply" }).click();
    await second
      .getByRole("button", { name: "Save task", exact: true })
      .click();
    await expect(
      second.getByRole("status").filter({ hasText: "Changes saved." }),
    ).toBeVisible();
    await second
      .getByLabel("Description", { exact: true })
      .fill("Draft survives auth repair");
    await second.context().clearCookies();
    await second
      .getByRole("button", { name: "Save task", exact: true })
      .click();
    await expect(
      second.getByRole("heading", { name: "Pair again to keep editing" }),
    ).toBeVisible();
    await second
      .getByLabel("Pairing token", { exact: true })
      .fill(server.credentials().pairingToken);
    await second.getByRole("button", { name: "Pair this browser" }).click();
    await expect(second.getByLabel("Description", { exact: true })).toHaveValue(
      "Draft survives auth repair",
    );
    await second.getByRole("button", { name: "Retry exact request" }).click();
    await expect(
      second.getByRole("status").filter({ hasText: "Changes saved." }),
    ).toBeVisible();
  } finally {
    await other.close();
    await server.stop();
  }
});
test("lost command responses retry the same identity without overwriting a newer task", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await fixture(page, server);
    await page.goto(f.boardUrl);
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await page
      .getByLabel("Description", { exact: true })
      .fill("Saved despite lost response");
    const requests: { body: string; key: string }[] = [];
    let lost = false;
    await page.route(`**/api/v1/tasks/${f.task.id}`, async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      requests.push({
        body: route.request().postData()!,
        key: route.request().headers()["idempotency-key"],
      });
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Retry exact request" }),
    ).toBeVisible();
    const result = await command(
      page,
      `/tasks/${f.task.id}`,
      { expectedVersion: 2, description: "Newer authoritative change" },
      "PATCH",
    );
    expect(result.status).toBe(200);
    await page.getByRole("button", { name: "Retry exact request" }).click();
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
      "Newer authoritative change",
    );
    expect(requests).toHaveLength(3);
    expect(requests[0]).toEqual(requests[2]);
    expect(requests[1].key).not.toBe(requests[0].key);
  } finally {
    await server.stop();
  }
});
test("dirty close stays in place, archived history is read-only, and filters reset pages", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await fixture(page, server);
    await page.goto(f.boardUrl);
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await page.getByLabel("Description", { exact: true }).fill("Unsaved draft");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Stay", exact: true }).click();
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
      "Unsaved draft",
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Discard and leave", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: f.task.title, exact: true }),
    ).toBeFocused();
    await command(
      page,
      `/projects/${f.project.id}`,
      { expectedVersion: 1, archived: true },
      "PATCH",
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Create task", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Add comment", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByLabel("Search", { exact: true }).fill("No synthetic match");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(
      page.getByRole("button", { name: f.task.title, exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(
      page.getByRole("button", { name: f.task.title, exact: true }),
    ).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("pointer drag moves only across lanes and Completed opens acceptance", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await fixture(page, server);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(f.boardUrl);
    const handle = page.getByRole("button", {
      name: `Drag ${f.task.title}`,
      exact: true,
    });
    async function drag(status: string, cancel = false) {
      const source = await handle.boundingBox();
      const target = await page
        .locator(`.lane[aria-label="${status}"]`)
        .boundingBox();
      if (!source || !target) throw new Error("Drag geometry missing");
      await page.mouse.move(
        source.x + source.width / 2,
        source.y + source.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        source.x + source.width / 2 + 12,
        source.y + source.height / 2,
        { steps: 3 },
      );
      await page.mouse.move(target.x + target.width / 2, target.y + 100, {
        steps: 15,
      });
      if (cancel) await page.keyboard.press("Escape");
      await page.mouse.up();
      await expect(page.locator(".dragging,.dropping")).toHaveCount(0);
    }
    await drag("In progress", true);
    await expect(page.locator('.lane[aria-label="Backlog"]')).toContainText(
      f.task.title,
    );
    await drag("Backlog");
    await expect(page.locator('.lane[aria-label="Backlog"]')).toContainText(
      f.task.title,
    );
    await drag("Completed");
    await expect(
      page.getByRole("status").filter({ hasText: "Move to Review first" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await drag("Review");
    await expect(page.locator('.lane[aria-label="Review"]')).toContainText(
      f.task.title,
    );
    await drag("Completed");
    await expect(
      page.getByRole("heading", { name: "Human acceptance", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".task-context")).toContainText("Review");
  } finally {
    await server.stop();
  }
});

test("lane, comments and both task-history continuations load beyond fifty records", async ({
  page,
}) => {
  test.setTimeout(60000);
  const server = await launch();
  try {
    const f = await fixture(page, server);
    const seeded = await page.evaluate(
      async ({ projectId, taskId }) => {
        async function send(path: string, body: unknown, method = "POST") {
          const response = await fetch("/api/v1" + path, {
            method,
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": crypto.randomUUID(),
            },
            body: JSON.stringify(body),
          });
          if (!response.ok)
            throw new Error("Synthetic fixture HTTP " + response.status);
          await new Promise((resolve) => setTimeout(resolve, 10));
          return (await response.json()).data;
        }
        let version = 1;
        for (let i = 0; i < 51; i++) {
          version = (
            await send(
              `/tasks/${taskId}`,
              { expectedVersion: version, status: "review" },
              "PATCH",
            )
          ).version;
          await send(`/tasks/${taskId}/complete`, {
            expectedVersion: version,
            evidenceNote: `Synthetic acceptance ${i}`,
          });
          version++;
          version = (
            await send(`/tasks/${taskId}/reopen`, {
              expectedVersion: version,
              reason: `Synthetic reopen ${i}`,
            })
          ).version;
        }
        for (let i = 0; i < 55; i++) {
          await send(`/tasks/${taskId}/comments`, {
            text: `Synthetic comment ${i}`,
          });
          await send("/tasks", {
            projectId,
            title: `Synthetic paged task ${i}`,
            tags: ["page-fixture"],
          });
        }
        return { version };
      },
      { projectId: f.project.id, taskId: f.task.id },
    );
    expect(seeded.version).toBe(154);
    await page.goto(f.boardUrl);
    await expect(
      page.locator('.lane[aria-label="Backlog"] .task-card'),
    ).toHaveCount(50);
    await page.getByRole("button", { name: "Load more tasks" }).click();
    await expect(
      page.locator('.lane[aria-label="Backlog"] .task-card'),
    ).toHaveCount(56);
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await expect(page.locator(".comments article")).toHaveCount(50);
    await page.getByRole("button", { name: "Load more comments" }).click();
    await expect(page.locator(".comments article")).toHaveCount(55);
    await expect(page.locator(".history-entry")).toHaveCount(100);
    await page.getByRole("button", { name: "Load more acceptances" }).click();
    await page.getByRole("button", { name: "Load more reopens" }).click();
    await expect(page.locator(".history-entry")).toHaveCount(102);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByLabel("Tag", { exact: true }).fill("page-fixture");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(
      page.locator('.lane[aria-label="Backlog"] .task-card'),
    ).toHaveCount(50);
    await page.getByRole("button", { name: "Load more tasks" }).click();
    await expect(
      page.locator('.lane[aria-label="Backlog"] .task-card'),
    ).toHaveCount(55);
  } finally {
    await server.stop();
  }
});

test("a generation reset discards a historical body but preserves the mounted edit", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await fixture(page, server);
    await page.goto(f.boardUrl);
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await page
      .getByLabel("Description", { exact: true })
      .fill("Draft across restored generation");
    let changed = false;
    const generation = crypto.randomUUID();
    await page.route("**/api/v1/**", async (route) => {
      if (
        route.request().url().endsWith(`/tasks/${f.task.id}`) &&
        route.request().method() === "PATCH" &&
        !changed
      ) {
        changed = true;
        const response = await route.fetch();
        const body = await response.json();
        await route.fulfill({
          response,
          headers: {
            ...response.headers(),
            "agentflow-generation": generation,
          },
          json: { ...body, generation: body.generation },
        });
        return;
      }
      if (changed) {
        const response = await route.fetch();
        const body = await response.json();
        await route.fulfill({
          response,
          headers: {
            ...response.headers(),
            "agentflow-generation": generation,
          },
          json: { ...body, generation },
        });
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
      "Draft across restored generation",
    );
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Workspace generation changed" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retry exact request" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Changes saved." }),
    ).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("service errors keep drafts and missing private records offer recovery", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await fixture(page, server);
    await page.goto(f.boardUrl);
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await page
      .getByLabel("Description", { exact: true })
      .fill("Held during database busy");
    let failed = false;
    await page.route(`**/api/v1/tasks/${f.task.id}`, async (route) => {
      if (route.request().method() === "PATCH" && !failed) {
        failed = true;
        await route.fulfill({
          status: 503,
          json: { error: { code: "database_busy" } },
        });
        return;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
      "Held during database busy",
    );
    await expect(
      page.getByRole("status").filter({ hasText: "database busy" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retry exact request" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Changes saved." }),
    ).toBeVisible();
    await page.goto(f.boardUrl + "/tasks/" + crypto.randomUUID());
    await expect(
      page.getByText("This record is unavailable. Return to Projects.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Back to work board" }),
    ).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("UTC browser initialization records version two once and settings conflicts retain input", async ({
  browser,
}) => {
  const server = await launch();
  const context = await browser.newContext({ timezoneId: "UTC" });
  const page = await context.newPage();
  try {
    await pairPage(page, server);
    await expect
      .poll(async () =>
        page.evaluate(
          async () =>
            (await (await fetch("/api/v1/settings")).json()).data.version,
        ),
      )
      .toBe(2);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByLabel("Timezone", { exact: true }).fill("Europe/London");
    await command(
      page,
      "/settings",
      { expectedVersion: 2, timezone: "Asia/Tokyo" },
      "PATCH",
    );
    await page.getByRole("button", { name: "Save timezone" }).click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Timezone changed in another browser" }),
    ).toBeVisible();
    await expect(page.getByLabel("Timezone", { exact: true })).toHaveValue(
      "Europe/London",
    );
    await expect(
      page.getByText("Saved timezone: Asia/Tokyo · version 3"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save timezone" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Timezone saved." }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Timezone", { exact: true })).toHaveValue(
      "Europe/London",
    );
    await expect(
      page.getByText("Saved timezone: Europe/London · version 4"),
    ).toBeVisible();
  } finally {
    await context.close();
    await server.stop();
  }
});

test("project metadata editing, archive confirmation and unarchive use persistent commands", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await fixture(page, server);
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page
      .getByRole("button", { name: "Edit project", exact: true })
      .click();
    await page.getByLabel("Project name").fill("Synthetic renamed project");
    await page
      .getByLabel("Repository path")
      .fill("/synthetic/changed-repository");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    await expect(
      page.getByRole("link", {
        name: "Synthetic renamed project",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await page.getByRole("button", { name: "Confirm archive" }).click();
    await expect(
      page.getByRole("link", {
        name: "Synthetic renamed project",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.getByLabel("Show archived projects").check();
    await expect(
      page.getByRole("link", {
        name: "Synthetic renamed project",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Unarchive", exact: true }).click();
    await page
      .getByRole("button", { name: "Unarchive project", exact: true })
      .click();
    await page.getByLabel("Show archived projects").uncheck();
    await page
      .getByRole("link", { name: "Synthetic renamed project", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Create task", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: f.task.title, exact: true }),
    ).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("acceptance cannot discard an editable draft and saving fields keeps its evidence note", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await fixture(page, server);
    await command(
      page,
      `/tasks/${f.task.id}`,
      { expectedVersion: 1, status: "review" },
      "PATCH",
    );
    await page.goto(f.boardUrl);
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await page
      .getByRole("button", { name: "Move task", exact: true })
      .last()
      .click();
    await page
      .getByRole("menuitem", { name: "Completed", exact: true })
      .click();
    await page
      .getByLabel("Description", { exact: true })
      .fill("UNSAVED MUST SURVIVE");
    await page
      .getByLabel("Acceptance evidence note", { exact: true })
      .fill("Evidence stays while the field draft is saved.");
    await expect(
      page.getByRole("button", { name: "Complete current revision" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
      "UNSAVED MUST SURVIVE",
    );
    await expect(
      page.getByLabel("Acceptance evidence note", { exact: true }),
    ).toHaveValue("Evidence stays while the field draft is saved.");
    await expect(page.locator(".task-context")).toContainText("Backlog");
    await expect(
      page.getByRole("button", { name: "Complete current revision" }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Move task", exact: true })
      .last()
      .click();
    await page.getByRole("menuitem", { name: "Review", exact: true }).click();
    await expect(page.locator(".task-context")).toContainText("Review");
    await expect(
      page.getByLabel("Acceptance evidence note", { exact: true }),
    ).toHaveValue("Evidence stays while the field draft is saved.");
    await page
      .getByRole("button", { name: "Complete current revision" })
      .click();
    await expect(page.locator(".task-context")).toContainText("Completed");
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
      "UNSAVED MUST SURVIVE",
    );
  } finally {
    await server.stop();
  }
});

test("cancelling acceptance preserves an unrelated comment draft and its dirty-close protection", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await fixture(page, server);
    await command(
      page,
      `/tasks/${f.task.id}`,
      { expectedVersion: 1, status: "review" },
      "PATCH",
    );
    await page.goto(f.boardUrl);
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await page
      .getByRole("button", { name: "Move task", exact: true })
      .last()
      .click();
    await page
      .getByRole("menuitem", { name: "Completed", exact: true })
      .click();
    await page
      .getByLabel("Add a comment", { exact: true })
      .fill("COMMENT MUST SURVIVE CANCEL");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Keep your draft?", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Stay", exact: true }).click();
    await expect(page.getByLabel("Add a comment", { exact: true })).toHaveValue(
      "COMMENT MUST SURVIVE CANCEL",
    );
  } finally {
    await server.stop();
  }
});

test("addressable task reload and Back preserve validated board filters", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await fixture(page, server);
    await command(
      page,
      `/tasks/${f.task.id}`,
      { expectedVersion: 1, tags: ["context"] },
      "PATCH",
    );
    await page.goto(f.boardUrl + "?q=Synthetic&priority=normal&tag=context");
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Back to work board" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to work board" }).click();
    await expect(page.getByLabel("Search", { exact: true })).toHaveValue(
      "Synthetic",
    );
    await expect(page.getByLabel("Tag", { exact: true })).toHaveValue(
      "context",
    );
    expect(new URL(page.url()).searchParams.get("priority")).toBe("normal");
  } finally {
    await server.stop();
  }
});

test("generation reset clears accumulated comment pages while retaining a comment draft", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await fixture(page, server);
    await page.evaluate(async (id) => {
      for (let i = 0; i < 51; i++) {
        const response = await fetch(`/api/v1/tasks/${id}/comments`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({ text: `OLD GENERATION COMMENT ${i}` }),
        });
        if (!response.ok)
          throw new Error("Fixture comment status " + response.status);
      }
    }, f.task.id);
    await page.goto(f.boardUrl);
    await page.getByRole("button", { name: f.task.title, exact: true }).click();
    await page.getByRole("button", { name: "Load more comments" }).click();
    await expect(page.locator(".comments article")).toHaveCount(51);
    await page
      .getByLabel("Add a comment", { exact: true })
      .fill("COMMENT DRAFT SURVIVES GENERATION");
    let reset = false;
    const generation = crypto.randomUUID();
    await page.route("**/api/v1/**", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      if (
        route.request().method() === "POST" &&
        route.request().url().includes(`/tasks/${f.task.id}/comments`)
      ) {
        if (!reset) {
          reset = true;
          await route.fulfill({
            response,
            headers: {
              ...response.headers(),
              "agentflow-generation": generation,
            },
            json: body,
          });
          return;
        }
      }
      if (
        reset &&
        route.request().method() === "GET" &&
        route.request().url().includes(`/tasks/${f.task.id}/comments`)
      ) {
        await route.fulfill({
          response,
          headers: {
            ...response.headers(),
            "agentflow-generation": generation,
          },
          json: {
            ...body,
            generation,
            data: { items: [], total: 0, nextCursor: null },
          },
        });
        return;
      }
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          ...(reset ? { "agentflow-generation": generation } : {}),
        },
        json: reset ? { ...body, generation } : body,
      });
    });
    await page
      .getByRole("button", { name: "Add comment", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Comments 0", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".comments article")).toHaveCount(0);
    await expect(page.getByLabel("Add a comment", { exact: true })).toHaveValue(
      "COMMENT DRAFT SURVIVES GENERATION",
    );
  } finally {
    await server.stop();
  }
});

test("Overview authoritative refresh clears obsolete loaded attention pages", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await fixture(page, server);
    const ids = await page.evaluate(async (projectId) => {
      const ids: string[] = [];
      for (let i = 0; i < 51; i++) {
        const response = await fetch("/api/v1/tasks", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            projectId,
            title: `Synthetic old attention ${i}`,
            blockedReason: "Synthetic blocker",
          }),
        });
        if (!response.ok) throw new Error("Fixture create " + response.status);
        ids.push((await response.json()).data.id);
      }
      return ids;
    }, f.project.id);
    await page.goto(server.url + "/");
    await page
      .getByRole("button", { name: "Load more attention items" })
      .click();
    await expect(page.locator(".attention-row")).toHaveCount(51);
    await page.evaluate(async (ids) => {
      for (const id of ids) {
        const response = await fetch(`/api/v1/tasks/${id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({ expectedVersion: 1, blockedReason: null }),
        });
        if (!response.ok) throw new Error("Fixture patch " + response.status);
      }
    }, ids);
    await expect(
      page.getByRole("heading", { name: "Needs attention 0", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".attention-row")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Load more attention items" }),
    ).toHaveCount(0);
  } finally {
    await server.stop();
  }
});

test("narrow direct task entry and reload focus the heading without stealing later editor focus", async ({
  page,
}) => {
  const server = await launch();
  try {
    const f = await fixture(page, server);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(
      f.boardUrl + `/tasks/${f.task.id}?q=Synthetic&priority=normal`,
    );
    const heading = page.getByRole("heading", {
      name: "Task details",
      exact: true,
    });
    await expect(heading).toBeFocused();
    await page.reload();
    await expect(heading).toBeFocused();
    await page
      .getByLabel("Description", { exact: true })
      .fill("Focused draft stays editable");
    await expect(page.getByLabel("Description", { exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Changes saved." }),
    ).toBeVisible();
    await expect(heading).not.toBeFocused();
    await page
      .getByLabel("Description", { exact: true })
      .fill("Dirty navigation draft");
    await page.getByRole("button", { name: "Back to work board" }).click();
    await expect(
      page.getByRole("heading", { name: "Keep your draft?", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Stay", exact: true }).click();
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
      "Dirty navigation draft",
    );
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await page.getByRole("button", { name: "Back to work board" }).click();
    await expect(page.getByLabel("Search", { exact: true })).toHaveValue(
      "Synthetic",
    );
    expect(new URL(page.url()).searchParams.get("priority")).toBe("normal");
  } finally {
    await server.stop();
  }
});
