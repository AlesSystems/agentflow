import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir, release } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { openOwnedStore } from "../../src/db";
import {
  ApplicationData,
  type ApplicationCommand,
  type ApplicationQuery,
} from "../../src/db/application";
import { canonicalDigest } from "../../src/domain/request-digest";
import { launch } from "../fixtures/server";
const output = process.env.AGENTFLOW_P04_EVIDENCE_DIR!;
if (!output) throw new Error("EVIDENCE_DIRECTORY_REQUIRED");
const dir = mkdtempSync(
  join(realpathSync(tmpdir()), "agentflow-p04-performance-"),
);
const startedAt = new Date().toISOString();
const owned = await openOwnedStore(dir);
let now = Date.now();
const send = (command: ApplicationCommand) =>
  owned.store.command(command, {
    principal: "reporter",
    method: "POST",
    path: command.kind,
    key: randomUUID(),
    digest: canonicalDigest(command.input),
    now: now++,
  });
const projectId = (
  send({ kind: "project.create", input: { name: "Synthetic P04 load" } }).body
    .data as { id: string }
).id;
const agentId = (
  send({
    kind: "agent.create",
    input: {
      displayName: "Synthetic P04 load",
      source: "fixture",
      defaultRole: "implementation",
    },
  }).body.data as { id: string }
).id;
const tasks: string[] = [];
const runs: string[] = [];
for (let i = 0; i < 1000; i++)
  tasks.push(
    (
      send({
        kind: "task.create",
        input: {
          projectId,
          title: "Synthetic task " + i,
          blockedReason: i % 50 === 0 ? "Synthetic dependency" : null,
        },
      }).body.data as { id: string }
    ).id,
  );
for (let i = 0; i < 10; i++) {
  const id = randomUUID();
  runs.push(id);
  send({
    kind: "run.register",
    input: {
      id,
      projectId,
      agentId,
      taskId: tasks[i],
      purpose: "implementation",
      expectedTaskVersion: 1,
    },
  });
  for (let sequence = 1; sequence <= 1000; sequence++)
    send({
      kind: "run.event",
      id,
      input: {
        schemaVersion: 1,
        eventId: randomUUID(),
        runId: id,
        sequence,
        type: sequence === 1 ? "run.started" : "run.heartbeat",
        occurredAt: "2026-10-10T00:00:00.000Z",
        payload: {},
      },
    });
}
function distribution(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: samples.length,
    p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
    samplesMs: samples,
  };
}
const comparisons: unknown[] = [];
if (process.env.AGENTFLOW_P04_BASE_SOURCE) {
  const { ApplicationData: Base } = await import(
    pathToFileURL(
      join(process.env.AGENTFLOW_P04_BASE_SOURCE, "src/db/application.ts"),
    ).href
  );
  const unregister = owned.instance.registerConnection();
  const db = new Database(join(dir, "agentflow.sqlite"), { readonly: true });
  try {
    const base = new Base(db, dir),
      head = new ApplicationData(db, dir);
    const captured = Date.now();
    const queries: Record<string, ApplicationQuery> = {
      tasks: { kind: "tasks", input: { projectId, limit: 50 } },
      detail: {
        kind: "task",
        id: tasks[0],
        input: { history: "both", historyLimit: 50 },
      },
      overview: { kind: "overview", input: { timezone: "UTC", limit: 50 } },
    };
    for (let run = 1; run <= 3; run++)
      for (const [name, query] of Object.entries(queries)) {
        const samples = { base: [] as number[], head: [] as number[] };
        for (let i = 0; i < 110; i++)
          for (const label of (i % 2 ? ["head", "base"] : ["base", "head"]) as (
            | "base"
            | "head"
          )[]) {
            const t = performance.now();
            const reply = (label === "base" ? base : head).snapshot(
              query,
              captured,
            );
            if (reply.status !== 200) throw new Error("QUERY_FAILED");
            if (i >= 10) samples[label].push(performance.now() - t);
          }
        const b = distribution(samples.base),
          h = distribution(samples.head);
        comparisons.push({
          run,
          name,
          base: b,
          head: h,
          p95ChangePercent: (h.p95Ms / b.p95Ms - 1) * 100,
        });
      }
  } finally {
    db.close();
    unregister();
  }
}
owned.close();
const server = await launch({ dir });
const sequences = runs.map(() => 1000);
const records: unknown[] = [];
try {
  const headers = {
    Authorization: "Bearer " + server.credentials().reporterToken,
    "Content-Type": "application/json",
  };
  async function emit(producer: number, phase: string) {
    const sequence = sequences[producer] + 1;
    const body = {
      schemaVersion: 1,
      eventId: randomUUID(),
      runId: runs[producer],
      sequence,
      type: "run.heartbeat",
      occurredAt: "2099-01-01T00:00:00Z",
      payload: {},
    };
    const t = performance.now();
    const response = await fetch(
      server.url + `/api/v1/runs/${runs[producer]}/events`,
      { method: "POST", headers, body: JSON.stringify(body) },
    );
    const reply = await response.json();
    const ms = performance.now() - t;
    records.push({ phase, producer, sequence, status: response.status, ms });
    if (response.status === 201) sequences[producer] = sequence;
    else if (response.status !== 429)
      throw new Error(
        "INGEST_STATUS_" + response.status + "_" + JSON.stringify(reply),
      );
  }
  for (let run = 1; run <= 3; run++) {
    const measuredStart = performance.now();
    for (let round = 0; round < 110; round++) {
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, measuredStart + round * 125 - performance.now()),
        ),
      );
      await Promise.all(
        runs.map((_, i) =>
          emit(i, round < 10 ? `warmup${run}` : `measured${run}`),
        ),
      );
    }
    console.log(
      JSON.stringify({
        phase: "measured",
        run,
        distribution: distribution(
          (records as { phase: string; status: number; ms: number }[])
            .filter((r) => r.phase === `measured${run}` && r.status === 201)
            .map((r) => r.ms),
        ),
      }),
    );
  }
  async function paced(phase: string, rate: number, seconds: number) {
    const t = performance.now();
    for (let tick = 0; tick < (rate * seconds) / 10; tick++) {
      const due = t + (tick * 10000) / rate;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, due - performance.now())),
      );
      await Promise.all(runs.map((_, i) => emit(i, phase)));
      if (tick % Math.round(rate * 6) === 0)
        console.log(
          JSON.stringify({
            phase,
            elapsedSeconds: (performance.now() - t) / 1000,
          }),
        );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, t + seconds * 1000 - performance.now())),
    );
    return (performance.now() - t) / 1000;
  }
  const sustainedSeconds = await paced("sustained20", 20, 300);
  const burstSeconds = await paced("burst100", 100, 10);
  const phases = Object.fromEntries(
    ["measured1", "measured2", "measured3", "sustained20", "burst100"].map(
      (phase) => {
        const matching = (
          records as { phase: string; status: number; ms: number }[]
        ).filter((r) => r.phase === phase);
        return [
          phase,
          {
            accepted: distribution(
              matching.filter((r) => r.status === 201).map((r) => r.ms),
            ),
            limited429: matching.filter((r) => r.status === 429).length,
            total: matching.length,
          },
        ];
      },
    ),
  );
  const db = new Database(join(dir, "agentflow.sqlite"), { readonly: true });
  let counts;
  try {
    counts = Object.fromEntries(
      ["tasks", "run_events", "runs"].map((t) => [
        t,
        (db.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n,
      ]),
    );
  } finally {
    db.close();
  }
  const artifact = {
    startedAt,
    finishedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      osRelease: release(),
      arch: process.arch,
    },
    fixture: { tasks: 1000, preseededEvents: 10000, orderedProducers: 10 },
    sustainedSeconds,
    burstSeconds,
    phases,
    comparisons,
    records,
    counts,
    base: "ced1c1be7dd9d170fc6139b77578f4159c9ebf80 ApplicationData snapshot on same owned fixture; no ingestion baseline",
    privacy:
      "Synthetic external temp DB, no operator data or credentials in artifact",
  };
  writeFileSync(
    join(output, "performance.json"),
    JSON.stringify(artifact, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      phases: Object.fromEntries(
        Object.entries(phases).map(([p, d]) => [
          p,
          {
            count: d.accepted.count,
            p95Ms: d.accepted.p95Ms,
            limited429: d.limited429,
          },
        ]),
      ),
      comparisons: comparisons.map((value) => {
        const r = value as {
          run: number;
          name: string;
          p95ChangePercent: number;
        };
        return {
          run: r.run,
          name: r.name,
          p95ChangePercent: r.p95ChangePercent,
        };
      }),
      counts,
    }),
  );
  if (Object.values(phases).some((d) => d.accepted.p95Ms >= 250))
    throw new Error("INGEST_P95_BUDGET");
} finally {
  await server.stop();
}
