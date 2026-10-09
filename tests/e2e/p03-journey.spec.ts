import { test, expect } from "@playwright/test";
import { launch } from "../fixtures/server";
test("synthetic manual acceptance journey persists across a production restart", async ({
  page,
  context,
}) => {
  let server = await launch();
  await context.route("**/*", (r) =>
    ["127.0.0.1", "localhost"].includes(new URL(r.request().url()).hostname)
      ? r.continue()
      : r.abort(),
  );
  try {
    await page.goto(server.url + "/pair");
    await page
      .getByLabel("Pairing token", { exact: true })
      .fill(server.credentials().pairingToken);
    await page.getByRole("button", { name: "Pair this browser" }).click();
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .first()
      .click();
    await page.getByLabel("Project name").fill("Synthetic P03 work");
    await page.getByLabel("Repository path").fill("/synthetic/repository");
    await page
      .getByRole("button", { name: "Save project", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Synthetic P03 work", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await page
      .getByLabel("Title", { exact: true })
      .fill("Verify synthetic board journey");
    await page
      .getByLabel("Acceptance criteria", { exact: true })
      .fill("The local manual journey persists.");
    await page.getByRole("button", { name: "Create task in Backlog" }).click();
    await page
      .getByRole("button", {
        name: "Verify synthetic board journey",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Description", { exact: true })
      .fill("Kept in SQLite");
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Changes saved." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Move task", exact: true })
      .last()
      .click();
    await page.getByRole("menuitem", { name: "Review", exact: true }).click();
    await expect(page.locator(".task-context")).toContainText("Review");
    await page
      .getByLabel("Add a comment", { exact: true })
      .fill("Synthetic acceptance fixture, not a human attestation.");
    await page
      .getByRole("button", { name: "Add comment", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Comment added." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Move task", exact: true })
      .last()
      .click();
    await page
      .getByRole("menuitem", { name: "Completed", exact: true })
      .click();
    await page
      .getByLabel("Acceptance evidence note", { exact: true })
      .fill("Synthetic browser fixture verifies the human-session command.");
    await page
      .getByRole("button", { name: "Complete current revision" })
      .click();
    await expect(page.locator(".task-context")).toContainText("Completed");
    await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Reopen task" }).click();
    await page.getByLabel("Reason for reopening").fill("Synthetic follow-up");
    await page.getByRole("button", { name: "Confirm reopen" }).click();
    await expect(page.getByLabel("Title", { exact: true })).toBeEnabled();
    const address = page.url();
    const dir = server.dir;
    const port = server.port;
    await server.stop();
    server = await launch({ dir, port });
    await page.goto(address);
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
      "Kept in SQLite",
      { timeout: 15000 },
    );
    await expect(
      page.getByText("Synthetic follow-up", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Synthetic acceptance fixture, not a human attestation.", {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("keyboard alone creates, edits, accepts, comments and reopens a synthetic task", async ({
  page,
}) => {
  const server = await launch();
  async function tabTo(locator: import("@playwright/test").Locator) {
    for (let i = 0; i < 100; i++) {
      if (await locator.evaluate((el) => el === document.activeElement)) return;
      await page.keyboard.press("Tab");
    }
    throw new Error("Keyboard target unreachable");
  }
  async function press(locator: import("@playwright/test").Locator) {
    await tabTo(locator);
    await page.keyboard.press("Enter");
  }
  async function type(
    locator: import("@playwright/test").Locator,
    value: string,
  ) {
    await tabTo(locator);
    await page.keyboard.press("Meta+A");
    await page.keyboard.insertText(value);
  }
  try {
    await page.goto(server.url + "/pair");
    await type(
      page.getByLabel("Pairing token", { exact: true }),
      server.credentials().pairingToken,
    );
    await press(page.getByRole("button", { name: "Pair this browser" }));
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await press(page.getByRole("link", { name: "Projects", exact: true }));
    await press(
      page.getByRole("button", { name: "Create project", exact: true }).first(),
    );
    await type(page.getByLabel("Project name"), "Synthetic keyboard project");
    await press(
      page.getByRole("button", { name: "Save project", exact: true }),
    );
    await press(
      page.getByRole("link", {
        name: "Synthetic keyboard project",
        exact: true,
      }),
    );
    await press(page.getByRole("button", { name: "Create task", exact: true }));
    await type(
      page.getByLabel("Title", { exact: true }),
      "Synthetic keyboard task",
    );
    await type(
      page.getByLabel("Acceptance criteria", { exact: true }),
      "Keyboard controls complete this journey.",
    );
    await press(page.getByRole("button", { name: "Create task in Backlog" }));
    await press(
      page.getByRole("button", {
        name: "Synthetic keyboard task",
        exact: true,
      }),
    );
    await type(
      page.getByLabel("Description", { exact: true }),
      "Edited from the keyboard",
    );
    await press(page.getByRole("button", { name: "Save task", exact: true }));
    await expect(
      page.getByRole("status").filter({ hasText: "Changes saved." }),
    ).toBeVisible();
    await press(
      page.getByRole("button", { name: "Move task", exact: true }).last(),
    );
    await expect(
      page.getByRole("menuitem", { name: "Review", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("r");
    await expect(
      page.getByRole("menuitem", { name: "Review", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".task-context")).toContainText("Review");
    await type(
      page.getByLabel("Add a comment", { exact: true }),
      "Synthetic keyboard acceptance test.",
    );
    await press(page.getByRole("button", { name: "Add comment", exact: true }));
    await expect(
      page.getByRole("status").filter({ hasText: "Comment added." }),
    ).toBeVisible();
    await press(
      page.getByRole("button", { name: "Move task", exact: true }).last(),
    );
    await expect(
      page.getByRole("menuitem", { name: "Completed", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("c");
    await expect(
      page.getByRole("menuitem", { name: "Completed", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await type(
      page.getByLabel("Acceptance evidence note", { exact: true }),
      "Synthetic keyboard fixture, not human attestation.",
    );
    await press(
      page.getByRole("button", { name: "Complete current revision" }),
    );
    await expect(page.locator(".task-context")).toContainText("Completed");
    await press(page.getByRole("button", { name: "Reopen task" }));
    await type(
      page.getByLabel("Reason for reopening"),
      "Synthetic keyboard follow-up",
    );
    await press(page.getByRole("button", { name: "Confirm reopen" }));
    await expect(page.getByLabel("Title", { exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", {
        name: "Synthetic keyboard task",
        exact: true,
      }),
    ).toBeFocused();
  } finally {
    await server.stop();
  }
});
