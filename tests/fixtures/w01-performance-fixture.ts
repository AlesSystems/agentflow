import { boundedLaunch, boundedFetch, readBoundedText } from "./w01-runtime";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import { sourceProvenance } from "./w01-provenance";
import type { seedPerformance } from "./p06-performance";
export const baselineSha = "dd26c4b00867e7680c3baf0cf2be39b60502aecf";
export type LegacySeed = Awaited<ReturnType<typeof seedPerformance>>;
export type WorkflowFixture = {
  dir: string;
  projectId: string;
  workflowId: string;
  revisionId: string;
  workflowRunId: string;
  nodeIds: string[];
  tasks: string[];
  linkedRuns: string[];
  lastSequence: number;
};
export type Prepared = {
  root: string;
  baseSource: string;
  headSource: string;
  seedDir: string;
  seed: LegacySeed;
  workflows: WorkflowFixture[];
  sources: Record<string, ReturnType<typeof sourceIdentity>>;
  files: Record<string, string>;
  schema: Record<string, unknown>;
};
export const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
function treeHashes(
  root: string,
  base = root,
  result: Record<string, string> = {},
) {
  for (const name of readdirSync(root).sort()) {
    if (name === "cache" || name === "trace" || name === "trace-build")
      continue;
    const path = join(root, name);
    if (statSync(path).isDirectory()) treeHashes(path, base, result);
    else result[relative(base, path)] = hash(readFileSync(path));
  }
  return result;
}
export function sourceIdentity(root: string) {
  const source = sourceProvenance(root);
  const require = createRequire(join(root, "package.json"));
  const NativeDatabase = require("better-sqlite3") as typeof Database;
  const probe = new NativeDatabase(":memory:");
  probe.close();
  const addons = Object.keys(require.cache).filter(
    (path) =>
      path.startsWith(root + "/") &&
      path.includes("better-sqlite3") &&
      path.endsWith(".node"),
  );
  assert.equal(
    addons.length,
    1,
    "one actual loaded source-owned SQLite addon required",
  );
  const measurementHelperHashes = Object.fromEntries(
    [
      "tests/performance/w01.ts",
      "tests/fixtures/w01-capture.ts",
      "tests/fixtures/w01-spool.ts",
      "tests/fixtures/w01-runtime.ts",
      "tests/fixtures/w01-performance-fixture.ts",
      "tests/fixtures/w01-legacy-performance.ts",
      "tests/fixtures/w01-workflow-performance.ts",
      "tests/fixtures/p07-native.ts",
      "tests/fixtures/p06-baseline-seed.ts",
      "tests/fixtures/p06-performance.ts",
      "tests/fixtures/p06-proxy.ts",
      "tests/fixtures/p07-proof-errors.ts",
      "tests/fixtures/p07-warm-error.ts",
      "tests/fixtures/p07-ordinary.ts",
    ]
      .filter((p) => existsSync(join(root, p)))
      .map((p) => [p, hash(readFileSync(join(root, p)))]),
  );
  return {
    ...source,
    measurementHelperHashes,
    sqliteAddonPath: addons[0],
    sqliteAddonSha256: hash(readFileSync(addons[0])),
    buildFiles: treeHashes(join(root, ".next")),
    qualification:
      "Separate owned source, exact lock, native addon and production build; no shared dependency/build substitution",
  };
}
function schema(dir: string) {
  const db = new Database(join(dir, "agentflow.sqlite"), { readonly: true });
  try {
    return {
      migration: db
        .prepare("SELECT * FROM migration_history ORDER BY id")
        .all(),
      tables: db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all(),
      counts: Object.fromEntries(
        ["tasks", "runs", "run_events"].map((table) => [
          table,
          (db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number })
            .n,
        ]),
      ),
      integrity: db.pragma("integrity_check"),
      foreignKeys: db.pragma("foreign_key_check"),
    };
  } finally {
    db.close();
  }
}
export async function workflowFixture(
  dir: string,
  seed: LegacySeed,
): Promise<WorkflowFixture> {
  const server = await boundedLaunch({ dir });
  try {
    async function post(path: string, input: unknown) {
      const response = await boundedFetch(server.url + "/api/v1" + path, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + server.credentials().reporterToken,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify(input),
      });
      const text = await readBoundedText(response);
      assert.equal(
        response.status,
        201,
        `workflow fixture rejected ${path}: ${text}`,
      );
      return JSON.parse(text).data;
    }
    const workflowId = randomUUID(),
      revisionId = randomUUID(),
      workflowRunId = randomUUID(),
      nodeIds = Array.from({ length: 100 }, () => randomUUID());
    await post("/workflows", {
      id: workflowId,
      projectId: seed.projectId,
      name: "Synthetic bounded W01 measurement",
    });
    const edges = [];
    for (let gap = 1; gap <= 2; gap++)
      for (let i = 0; i + gap < 100; i++)
        edges.push({ source: nodeIds[i], target: nodeIds[i + gap] });
    for (let i = 0; i < 3; i++)
      edges.push({ source: nodeIds[i], target: nodeIds[i + 3] });
    assert.equal(edges.length, 200);
    await post(`/workflows/${workflowId}/revisions`, {
      id: revisionId,
      expectedWorkflowVersion: 1,
      nodes: nodeIds.map((id, i) => ({
        id,
        label: `Synthetic plan node ${i}`,
        taskId: seed.tasks[i],
      })),
      edges,
    });
    await post("/workflow-runs", {
      id: workflowRunId,
      workflowId,
      planRevisionId: revisionId,
    });
    await post(`/workflow-runs/${workflowRunId}/events`, {
      schemaVersion: 1,
      eventId: randomUUID(),
      workflowRunId,
      sequence: 1,
      type: "workflow.started",
      occurredAt: new Date().toISOString(),
      payload: {},
    });
    for (let i = 0; i < 100; i++)
      await post(`/workflow-runs/${workflowRunId}/events`, {
        schemaVersion: 1,
        eventId: randomUUID(),
        workflowRunId,
        sequence: i + 2,
        type: "workflow.node.reported",
        occurredAt: new Date().toISOString(),
        payload: {
          nodeId: nodeIds[i],
          state: "pending",
          ...(i < 10 ? { runId: seed.runs[i] } : {}),
          reportedSkill: {
            name: "Synthetic inert skill",
            source: "synthetic://W01/measure",
            version: "1",
          },
        },
      });
    return {
      dir,
      projectId: seed.projectId,
      workflowId,
      revisionId,
      workflowRunId,
      nodeIds,
      tasks: seed.tasks,
      linkedRuns: seed.runs,
      lastSequence: 101,
    };
  } finally {
    await server.stop();
  }
}
export async function preparePerformance(
  root: string,
  baseSource: string,
): Promise<Prepared> {
  assert(
    isAbsolute(root) && isAbsolute(baseSource),
    "owned absolute preparation paths required",
  );
  assert(!existsSync(root), "fresh owned preparation directory required");
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: baseSource,
      encoding: "utf8",
    }).trim(),
    baselineSha,
    "exact P07 baseline required",
  );
  assert.equal(
    execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: baseSource })
      .length,
    0,
    "baseline source must be clean",
  );
  assert(
    !root.startsWith(process.cwd() + "/") && !root.startsWith(baseSource + "/"),
    "prepared data outside both sources required",
  );
  mkdirSync(root, { mode: 0o700 });
  const seedDir = join(root, "base-seed"),
    seedOutput = join(root, "seed.json");
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      join(process.cwd(), "tests/fixtures/p06-baseline-seed.ts"),
      join(baseSource, "tests/fixtures/p06-performance.ts"),
      seedDir,
      JSON.stringify({ tasks: 1000, events: 10000, producers: 10 }),
      seedOutput,
    ],
    { cwd: baseSource, stdio: ["ignore", "pipe", "pipe"] },
  );
  const seed = JSON.parse(readFileSync(seedOutput, "utf8")) as LegacySeed;
  const headSeed = join(root, "head-upgraded-seed");
  cpSync(seedDir, headSeed, { recursive: true });
  const upgrade = await boundedLaunch({ dir: headSeed });
  await upgrade.stop();
  const workflows: WorkflowFixture[] = [];
  for (let i = 1; i <= 3; i++) {
    const dir = join(root, `workflow-seed-${i}`);
    cpSync(headSeed, dir, { recursive: true });
    workflows.push(await workflowFixture(dir, seed));
  }
  const schemas = {
    base: schema(seedDir),
    head: schema(headSeed),
    workflows: workflows.map((v) => schema(v.dir)),
  };
  for (const entry of [schemas.base, schemas.head, ...schemas.workflows]) {
    assert.deepEqual(entry.integrity, [{ integrity_check: "ok" }]);
    assert.deepEqual(entry.foreignKeys, []);
    assert.deepEqual(entry.counts, {
      tasks: 1000,
      runs: 20,
      run_events: 10000,
    });
  }
  const prepared = {
    root,
    baseSource,
    headSource: process.cwd(),
    seedDir,
    seed,
    workflows,
    sources: {
      base: sourceIdentity(baseSource),
      head: sourceIdentity(process.cwd()),
    },
    files: treeHashes(root),
    schema: schemas,
  };
  writeFileSync(
    join(root, "prepared.json"),
    JSON.stringify(prepared, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  return prepared;
}
export function readPrepared(root: string): Prepared {
  const value = JSON.parse(
    readFileSync(join(root, "prepared.json"), "utf8"),
  ) as Prepared;
  assert.equal(value.root, root);
  assert.equal(value.headSource, process.cwd());
  for (const label of ["base", "head"]) {
    const source = label === "base" ? value.baseSource : value.headSource;
    assert.deepEqual(
      sourceIdentity(source),
      value.sources[label],
      `frozen ${label} source/build changed`,
    );
  }
  const files = treeHashes(root);
  delete files["prepared.json"];
  assert.deepEqual(files, value.files, "frozen fixture files changed");
  return value;
}
