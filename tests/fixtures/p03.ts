import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { launch } from "./server";
export async function pairPage(
  page: Page,
  server: Awaited<ReturnType<typeof launch>>,
) {
  await page.goto(server.url + "/pair");
  await page
    .getByLabel("Pairing token", { exact: true })
    .fill(server.credentials().pairingToken);
  await page.getByRole("button", { name: "Pair this browser" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}
export async function command(
  page: Page,
  path: string,
  body: unknown,
  method = "POST",
) {
  return page.evaluate(
    async ({ path, body, method }) => {
      const response = await fetch("/api/v1" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, body, method },
  );
}
export async function fixture(
  page: Page,
  server: Awaited<ReturnType<typeof launch>>,
) {
  await pairPage(page, server);
  const project = await command(page, "/projects", {
    name: "Synthetic recovery project",
  });
  expect(project.status).toBe(201);
  const task = await command(page, "/tasks", {
    projectId: project.body.data.id,
    title: "Synthetic shared task",
    description: "Saved original",
    acceptanceCriteria: "Inspect the synthetic evidence.",
  });
  expect(task.status).toBe(201);
  return {
    project: project.body.data,
    task: task.body.data,
    boardUrl: server.url + `/projects/${project.body.data.id}`,
  };
}
