import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openOwnedStore } from "../../src/db";
import { canonicalDigest } from "../../src/domain/request-digest";
import type { ApplicationCommand } from "../../src/db/application";
import { seedRun, persistedCounts } from "../fixtures/application";
import { launch } from "../fixtures/server";
const dir = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-performance-"));
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
    runs.push({ run, distributions });
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
    platform: process.platform,
    arch: process.arch,
  },
  counts,
  runs,
  comparison:
    "P01 base has no equivalent endpoints; absolute budget only. P07 10000-event fixture awaits P04.",
};
writeFileSync(
  "docs/evidence/P02/performance.json",
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
