import { mkdtempSync, realpathSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openOwnedStore } from "../../src/db";
import { canonicalDigest } from "../../src/domain/request-digest";
import type { ApplicationCommand } from "../../src/db/application";
import { seedRun, persistedCounts } from "../fixtures/application";
import { launch } from "../fixtures/server";
import { chromium } from "@playwright/test";
import { hostname } from "node:os";
const dir = mkdtempSync(
  join(realpathSync(tmpdir()), "agentflow-p03-performance-"),
);
const owned = await openOwnedStore(dir);
let now = Date.now();
const send = (command: ApplicationCommand) =>
  owned.store.command(command, {
    principal: "operator",
    method: "POST",
    path: command.kind,
    key: randomUUID(),
    digest: canonicalDigest(command),
    now: now++,
  });
const projectId = (
  send({
    kind: "project.create",
    input: { name: "Synthetic performance project" },
  }).body.data as { id: string }
).id;
for (let i = 0; i < 1000; i++) {
  const id = (
    send({
      kind: "task.create",
      input: {
        projectId,
        title: "Synthetic performance task " + i,
        description: "Bounded synthetic work description",
        tags: i % 3 === 0 ? ["fixture"] : [],
        blockedReason: i % 50 === 0 ? "Synthetic dependency" : null,
      },
    }).body.data as { id: string }
  ).id;
  if (i < 100) {
    seedRun(owned.instance, {
      projectId,
      taskId: id,
      state: "succeeded",
      workRevision: 1,
      createdAt: now++,
      receivedAt: now,
      endedAt: now,
    });
    send({
      kind: "task.patch",
      id,
      input: { expectedVersion: 1, status: "review" },
    });
    send({
      kind: "task.complete",
      id,
      input: {
        expectedVersion: 2,
        evidenceNote: "Synthetic performance acceptance fixture",
      },
    });
  } else if (i < 300)
    send({
      kind: "task.patch",
      id,
      input: { expectedVersion: 1, status: "review" },
    });
  else if (i < 600)
    send({
      kind: "task.patch",
      id,
      input: { expectedVersion: 1, status: "in_progress" },
    });
  if (i >= 100 && i < 200)
    seedRun(owned.instance, {
      projectId,
      taskId: id,
      state: i % 2 ? "failed" : "running",
      workRevision: 1,
      createdAt: now++,
      receivedAt: i % 2 ? now : now - 90000,
      endedAt: i % 2 ? now : undefined,
    });
  if (i < 300)
    send({
      kind: "comment.create",
      id,
      input: { text: "Synthetic bounded context" },
    });
}
const counts = persistedCounts(owned.instance);
owned.close();
const paths = {
  tasks: "/api/v1/tasks?projectId=" + projectId + "&limit=50",
  board: "/api/v1/projects/" + projectId + "/board?limit=50",
  overview: "/api/v1/overview?timezone=UTC&limit=50",
};
const runs: unknown[] = [];
for (let run = 1; run <= 3; run++) {
  const server = await launch({ dir });
  try {
    const browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const boardLoads: { kind: string; ms: number }[] = [];
    try {
      await page.goto(server.url + "/pair");
      await page
        .getByLabel("Pairing token", { exact: true })
        .fill(server.credentials().pairingToken);
      await page.getByRole("button", { name: "Pair this browser" }).click();
      await page
        .getByRole("heading", { name: "Overview", exact: true })
        .waitFor();
      for (let load = 0; load < 6; load++) {
        const start = performance.now();
        await page.goto(server.url + "/projects/" + projectId);
        await page.locator(".task-card").nth(199).waitFor();
        boardLoads.push({
          kind:
            load === 0
              ? "cold browser board navigation"
              : "warm browser board navigation",
          ms: performance.now() - start,
        });
      }
    } finally {
      await browser.close();
    }
    const distributions: Record<string, unknown> = {};
    for (const [name, path] of Object.entries(paths)) {
      const samples: number[] = [];
      for (let i = 0; i < 110; i++) {
        const start = performance.now();
        const response = await fetch(server.url + path, {
          headers: {
            Authorization: "Bearer " + server.credentials().reporterToken,
          },
        });
        if (response.status !== 200)
          throw new Error("BENCHMARK_HTTP_" + response.status);
        await response.json();
        const duration = performance.now() - start;
        if (i >= 10) samples.push(duration);
      }
      const sorted = [...samples].sort((a, b) => a - b);
      const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
      if (p95 >= 250) throw new Error("SNAPSHOT_BUDGET_EXCEEDED_" + name);
      distributions[name] = {
        samplesMs: samples,
        p50Ms: sorted[49],
        p95Ms: p95,
        maxMs: sorted.at(-1),
        budgetMs: 250,
      };
    }
    runs.push({ run, boardLoads, distributions });
  } finally {
    await server.stop();
  }
}
const evidence = {
  schemaVersion: 1,
  fixture:
    "Synthetic producer facts and synthetic browser acceptance fixtures; no actual human attestation",
  runtime: {
    node: process.version,
    host: hostname(),
    platform: process.platform,
    arch: process.arch,
  },
  counts,
  runs,
  comparison:
    "P02 supplies the same API fixture; P02 has no equivalent Work board UI. Absolute read budget enforced. P07 10000-event fixture awaits P04.",
};
mkdirSync("docs/evidence/P03", { recursive: true });
writeFileSync(
  "docs/evidence/P03/performance.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    counts,
    runs: runs.map((value) => {
      const record = value as {
        run: number;
        distributions: Record<string, { p95Ms: number }>;
      };
      return {
        run: record.run,
        p95Ms: Object.fromEntries(
          Object.entries(record.distributions).map(([name, d]) => [
            name,
            d.p95Ms,
          ]),
        ),
      };
    }),
  }),
);
