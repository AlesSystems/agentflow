import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import Database from "better-sqlite3";
import { eventInput, eventResponse } from "../../src/contracts/observations";
import { canonicalDigest } from "../../src/domain/request-digest";
import { nativeCompare } from "../fixtures/p07-native";
import { proofErrors } from "../fixtures/p07-proof-errors";
import { ordinaryBoundary } from "../fixtures/p07-ordinary";
import {
  preparePerformance,
  readPrepared,
  sourceIdentity,
  type Prepared,
} from "../fixtures/w01-performance-fixture";
import { legacyCompare } from "../fixtures/w01-legacy-performance";
import {
  workflowQueries,
  visibilityScenario,
} from "../fixtures/w01-workflow-performance";
import {
  summarizeVisibility,
  type VisibleCapture,
  type VisibleIdentity,
} from "../fixtures/w01-capture";
export const definition = {
  nativeHTTP: {
    operations: [
      "ingestion",
      "tasks",
      "detail",
      "board",
      "overview",
      "tracking",
      "events",
      "taskCreationHTTP",
    ],
    repetitions: 3,
    sources: 2,
    warmups: 10,
    measuredPerOperationSourceRun: 100,
    absoluteP95Ms: 250,
    relativeP95RegressionPercent: 20,
  },
  legacyCLI: {
    operations: [
      "legacyOnlineReport",
      "legacyDurableQueue",
      "legacyFlushSingle",
    ],
    repetitions: 3,
    sources: 2,
    warmups: 10,
    measuredPerOperationSourceRun: 100,
    relativeP95RegressionPercent: 20,
    processKillBoundMs: 20000,
    nativeDeliveryDeadlineMs: 5000,
    timing:
      "Controller spawn→exit includes startup, native filesystem work, HTTP requests and retries/backoff. Native HTTP250ms budget is not applied to process wall time. Queue uses native delivery lease and expected exit2; online/one-event flush require exit0.",
  },
  workflowHTTP: {
    operations: [
      "revision",
      "attemptMetadata",
      "snapshot",
      "attempts",
      "nodeHistory",
      "workflowIngestion",
    ],
    repetitions: 3,
    nodes: 100,
    edges: 200,
    warmups: 10,
    measuredPerOperationRun: 100,
    absoluteP95Ms: 250,
  },
  visibility: {
    scenarios: 3,
    reportsPerScenario: 10,
    contexts: 2,
    expectedObservations: 60,
    warmups: 0,
    absoluteP95Ms: 2000,
    captureBoundMs: 5000,
    timing:
      "Single controller CLI dispatch→two-frame exact identity, visible and hit-tested completion. Includes real CLI startup. No server/browser clock subtraction. All observations, missing/wrong/duplicate/hidden/unconfirmed/late counts retained.",
  },
  originalEventACKJoins: {
    native: 660,
    legacyCLI: 1320,
    workflowHTTP: 330,
    visibility: 30,
    total: 2340,
    qualification:
      "Includes measured and10 warmup events; fixture seed events excluded. Full decoded original response text joins immutable SQLite ACK/body/digest/identity; not compressed wire bytes.",
  },
};
async function nativeIdentity(
  index: number,
  prepared: Prepared,
  root: string,
  receipt: { comparisons: unknown[] },
  save: () => void,
  samples: number,
  validate = true,
) {
  const comparison = receipt.comparisons[index - 1] as {
    requests: {
      label: string;
      operation: string;
      input: unknown;
      text: string | null;
      response: unknown;
      generation: string | null;
    }[];
    identity?: unknown;
  };
  const raw: Record<string, unknown> = {};
  comparison.identity = raw;
  for (const label of ["base", "head"]) {
    const db = new Database(
      join(root, `comparison-${index}-${label}`, "agentflow.sqlite"),
      { readonly: true },
    );
    try {
      raw[label] = {
        rows: db
          .prepare(
            `SELECT event_id,run_id,sequence,digest,body,acknowledgement FROM run_events WHERE run_id IN (${prepared.seed.runs.map(() => "?").join(",")}) ORDER BY run_id,sequence`,
          )
          .all(...prepared.seed.runs),
        counts: {
          tasks: (
            db.prepare("SELECT count(*) n FROM tasks").get() as { n: number }
          ).n,
          events: (
            db.prepare("SELECT count(*) n FROM run_events").get() as {
              n: number;
            }
          ).n,
        },
        integrity: db.pragma("integrity_check"),
        foreignKeys: db.pragma("foreign_key_check"),
      };
    } finally {
      db.close();
    }
  }
  save();
  if (!validate) return;
  for (const label of ["base", "head"]) {
    const captured = raw[label] as {
      rows: {
        event_id: string;
        run_id: string;
        sequence: number;
        digest: string;
        body: string;
        acknowledgement: string;
      }[];
      counts: { tasks: number; events: number };
    };
    assert.equal(captured.counts.tasks, 1000);
    assert.equal(captured.counts.events, 10000 + samples + 10);
    assert.equal(captured.rows.length, samples + 10);
    const requests = comparison.requests.filter(
      (r) => r.label === label && r.operation === "ingestion",
    );
    assert.equal(requests.length, samples + 10);
    for (const fact of requests) {
      const input = eventInput.parse(fact.input),
        row = captured.rows.find((r) => r.event_id === input.eventId);
      assert(row);
      assert.equal(row.run_id, input.runId);
      assert.equal(row.sequence, input.sequence);
      assert.equal(row.digest, canonicalDigest(input));
      const { receivedAt, ...storedInput } = JSON.parse(row.body);
      assert.equal(typeof receivedAt, "string");
      assert.deepEqual(storedInput, input);
      assert.equal(row.acknowledgement, fact.text);
      const ack = eventResponse.parse(JSON.parse(row.acknowledgement));
      assert.equal(ack.data.eventId, input.eventId);
      assert.equal(ack.data.runId, input.runId);
      assert.equal(ack.data.acceptedSequence, input.sequence);
      assert.equal(ack.generation, fact.generation);
    }
  }
}
const mode = process.argv[2];
assert(
  ["--prepare", "--control", "--acceptance"].includes(mode),
  "explicit W01 preparation/control/acceptance mode required",
);
const preparedRoot = process.env.AGENTFLOW_W01_PREPARED_ROOT;
assert(
  preparedRoot && isAbsolute(preparedRoot),
  "owned prepared root required",
);
if (mode === "--prepare") {
  const base = process.env.AGENTFLOW_W01_BASE_SOURCE;
  assert(
    base && isAbsolute(base),
    "prepared owned P07 baseline source required",
  );
  const prepared = await preparePerformance(preparedRoot, base);
  console.log(
    JSON.stringify({
      mode,
      acceptance: false,
      root: prepared.root,
      fixtures: prepared.workflows.length,
      definition,
    }),
  );
} else {
  const acceptance = mode === "--acceptance";
  if (acceptance)
    assert.equal(
      process.env.AGENTFLOW_W01_QUIET_RELEASE,
      "1",
      "Root's separate frozen quiet release required",
    );
  const prepared = readPrepared(preparedRoot),
    evidence = process.env.AGENTFLOW_W01_EVIDENCE_DIR;
  assert(
    evidence && isAbsolute(evidence) && !existsSync(evidence),
    "fresh owned evidence root required",
  );
  assert(
    !evidence.startsWith(process.cwd() + "/"),
    "evidence outside source required",
  );
  mkdirSync(evidence, { mode: 0o700 });
  const root = join(evidence, "runtime");
  mkdirSync(root, { mode: 0o700 });
  const repetitions = acceptance ? 3 : 1,
    samples = acceptance ? 100 : 1,
    reports = acceptance ? 10 : 2;
  const receipt = {
    mode: acceptance ? "acceptance" : "helper-control",
    acceptance,
    definition,
    actualCounts: { repetitions, samples, warmups: 10, reports, contexts: 2 },
    startedAt: new Date().toISOString(),
    sources: prepared.sources,
    preparedFiles: prepared.files,
    comparisons: [] as unknown[],
    legacy: [] as unknown[],
    workflow: [] as unknown[],
    visibility: [] as unknown[],
    visibilitySummary: null as ReturnType<typeof summarizeVisibility> | null,
    failures: [] as string[],
  };
  const save = () => {
    const temp = join(evidence, `performance-${randomUUID()}.tmp`);
    writeFileSync(temp, JSON.stringify(receipt, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temp, join(evidence, "performance.json"));
  };
  await ordinaryBoundary(
    receipt,
    async (safeSave) => {
      for (let index = 1; index <= repetitions; index++) {
        const nativeErrors = proofErrors((error) =>
          receipt.failures.push(
            error instanceof Error ? error.message : "native stage failure",
          ),
        );
        await nativeErrors.attempt("native comparison", async () =>
          nativeCompare({
            index,
            baseSource: prepared.baseSource,
            seed: prepared.seed,
            seedDir: prepared.seedDir,
            root,
            counts: { samples, producers: 10 },
            acceptance,
            receipt,
            save: safeSave,
          }),
        );
        await nativeErrors.attempt(
          "native original identity capture",
          async () =>
            nativeIdentity(
              index,
              prepared,
              root,
              receipt,
              safeSave,
              samples,
              !nativeErrors.failed(),
            ),
        );
        nativeErrors.throwFirst();
        await legacyCompare(
          index,
          prepared,
          root,
          samples,
          acceptance,
          receipt,
          safeSave,
        );
        await workflowQueries(
          index,
          prepared.workflows[index - 1],
          root,
          samples,
          acceptance,
          receipt,
          safeSave,
        );
        await visibilityScenario(
          index,
          prepared.workflows[index - 1],
          root,
          reports,
          acceptance,
          receipt,
          safeSave,
        );
      }
      const visible = receipt.visibility as {
        expected: (VisibleIdentity & { context: number })[];
        observations: VisibleCapture[];
      }[];
      receipt.visibilitySummary = summarizeVisibility(
        visible.flatMap((v) => v.expected),
        visible.flatMap((v) => v.observations),
      );
      assert.equal(
        receipt.visibilitySummary.expected,
        repetitions * reports * 2,
      );
      assert(receipt.visibilitySummary.valid);
      assert.equal(
        receipt.failures.length,
        0,
        "W01 performance budgets remain open",
      );
      assert.deepEqual(
        sourceIdentity(process.cwd()),
        prepared.sources.head,
        "head source/build changed during run",
      );
      assert.deepEqual(
        sourceIdentity(prepared.baseSource),
        prepared.sources.base,
        "base source/build changed during run",
      );
      safeSave();
    },
    save,
    () =>
      console.log(
        JSON.stringify({
          mode: receipt.mode,
          acceptance,
          comparisons: receipt.comparisons.length,
          visibility: receipt.visibilitySummary,
          failures: receipt.failures,
        }),
      ),
    () => {
      process.exitCode = 1;
    },
  ).catch(() => {
    process.exitCode = 1;
  });
}
