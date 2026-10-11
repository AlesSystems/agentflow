import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import {
  revisionResponse,
  workflowRunResponse,
  workflowRunDetailResponse,
  workflowRunsResponse,
  workflowNodeHistoryResponse,
  workflowEventInput,
  workflowEventResponse,
} from "../../src/contracts/workflows";
import { canonicalDigest } from "../../src/domain/request-digest";
import { launch, pair } from "./server";
import { publicProxy } from "./p06-proxy";
import { proofErrors } from "./p07-proof-errors";
import { failureFact } from "./p07-warm-error";
import {
  distribution,
  visibleFrames,
  summarizeVisibility,
  type VisibleCapture,
} from "./w01-capture";
import { invokeCli } from "./w01-legacy-performance";
import type { WorkflowFixture } from "./w01-performance-fixture";
type WorkflowDatabase = {
  rows: {
    event_id: string;
    workflow_run_id: string;
    sequence: number;
    digest: string;
    body: string;
    acknowledgement: string;
  }[];
  integrity: unknown;
  foreignKeys: unknown;
};
function database(dir: string, runId: string): WorkflowDatabase {
  const db = new Database(join(dir, "agentflow.sqlite"), { readonly: true });
  try {
    return {
      rows: db
        .prepare(
          "SELECT event_id,workflow_run_id,sequence,digest,body,acknowledgement FROM workflow_events WHERE workflow_run_id=? ORDER BY sequence",
        )
        .all(runId) as {
        event_id: string;
        workflow_run_id: string;
        sequence: number;
        digest: string;
        body: string;
        acknowledgement: string;
      }[],
      integrity: db.pragma("integrity_check"),
      foreignKeys: db.pragma("foreign_key_check"),
    };
  } finally {
    db.close();
  }
}
export async function workflowQueries(
  index: number,
  fixture: WorkflowFixture,
  root: string,
  samples: number,
  acceptance: boolean,
  receipt: { workflow: unknown[]; failures: string[] },
  save: () => void,
) {
  const dir = join(root, `workflow-query-${index}`);
  cpSync(fixture.dir, dir, { recursive: true });
  const operations = Object.fromEntries(
    [
      "revision",
      "attemptMetadata",
      "snapshot",
      "attempts",
      "nodeHistory",
      "workflowIngestion",
    ].map((name) => [name, [] as number[]]),
  );
  const result = {
    index,
    status: "unfinalized",
    fixture: { nodes: 100, edges: 200 },
    requests: [] as {
      operation: string;
      ordinal: number;
      warmup: boolean;
      input: unknown;
      dispatchMs: number;
      completedMs: number | null;
      ms: number | null;
      status: number | null;
      generation: string | null;
      responseText: string | null;
    }[],
    operations: {} as Record<string, unknown>,
    database: null as ReturnType<typeof database> | null,
    missing: 6 * samples,
    failure: "",
    budgetFailures: [] as string[],
  };
  receipt.workflow.push(result);
  const errors = proofErrors((error) => {
    result.failure = failureFact(error).message;
    result.status = "unfinalized";
  });
  Object.assign(result, { failureFacts: errors.facts });
  let server: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    errors.save(save, "workflow query initial save", true);
    server = await launch({ dir });
    const reads = {
      revision: {
        path: `/workflows/${fixture.workflowId}/revisions/${fixture.revisionId}`,
        schema: revisionResponse,
      },
      attemptMetadata: {
        path: `/workflow-runs/${fixture.workflowRunId}`,
        schema: workflowRunResponse,
      },
      snapshot: {
        path: `/workflow-runs/${fixture.workflowRunId}/snapshot`,
        schema: workflowRunDetailResponse,
      },
      attempts: {
        path: `/workflow-runs?workflowId=${fixture.workflowId}&planRevisionId=${fixture.revisionId}&limit=50`,
        schema: workflowRunsResponse,
      },
      nodeHistory: {
        path: `/workflow-runs/${fixture.workflowRunId}/nodes/${fixture.nodeIds[0]}/observations?limit=50`,
        schema: workflowNodeHistoryResponse,
      },
    };
    for (let ordinal = 0; ordinal < samples + 10; ordinal++) {
      const body = workflowEventInput.parse({
        schemaVersion: 1,
        eventId: randomUUID(),
        workflowRunId: fixture.workflowRunId,
        sequence: fixture.lastSequence + ordinal + 1,
        type: "workflow.node.reported",
        occurredAt: new Date().toISOString(),
        payload: { nodeId: fixture.nodeIds[0], state: "running" },
      });
      for (const name of ["workflowIngestion", ...Object.keys(reads)]) {
        const operation = name as keyof typeof operations,
          read = reads[name as keyof typeof reads],
          input = name === "workflowIngestion" ? body : read.path;
        const fact = {
          operation: name,
          ordinal,
          warmup: ordinal < 10,
          input,
          dispatchMs: performance.now(),
          completedMs: null as number | null,
          ms: null as number | null,
          status: null as number | null,
          generation: null as string | null,
          responseText: null as string | null,
        };
        result.requests.push(fact);
        const response: Response = await fetch(
          server.url +
            "/api/v1" +
            (name === "workflowIngestion"
              ? `/workflow-runs/${fixture.workflowRunId}/events`
              : read.path),
          {
            method: name === "workflowIngestion" ? "POST" : "GET",
            headers: {
              Authorization: "Bearer " + server.credentials().reporterToken,
              ...(name === "workflowIngestion"
                ? { "Content-Type": "application/json" }
                : {}),
            },
            body:
              name === "workflowIngestion" ? JSON.stringify(body) : undefined,
          },
        );
        fact.status = response.status;
        fact.generation = response.headers.get("agentflow-generation");
        const text = await response.text();
        fact.responseText = text;
        const decoded = JSON.parse(text);
        fact.completedMs = performance.now();
        fact.ms = fact.completedMs - fact.dispatchMs;
        assert.equal(response.status, name === "workflowIngestion" ? 201 : 200);
        const parsed = (
          name === "workflowIngestion" ? workflowEventResponse : read.schema
        ).parse(decoded);
        assert.equal(parsed.generation, fact.generation);
        if (name === "workflowIngestion") {
          const ack = workflowEventResponse.parse(decoded).data;
          assert.equal(ack.eventId, body.eventId);
          assert.equal(ack.workflowRunId, fixture.workflowRunId);
          assert.equal(ack.acceptedSequence, body.sequence);
        }
        if (name === "revision") {
          const plan = revisionResponse.parse(decoded).data;
          assert.equal(plan.id, fixture.revisionId);
          assert.equal(plan.workflowId, fixture.workflowId);
          assert.equal(plan.nodes.length, 100);
          assert.equal(plan.edges.length, 200);
        }
        if (name === "snapshot") {
          const snapshot = workflowRunDetailResponse.parse(decoded).data;
          assert.equal(snapshot.id, fixture.workflowRunId);
          assert.equal(snapshot.workflowId, fixture.workflowId);
          assert.equal(snapshot.planRevisionId, fixture.revisionId);
          assert.equal(snapshot.nodes.length, 100);
          assert.equal(
            snapshot.nodes.find((n) => n.nodeId === fixture.nodeIds[0])
              ?.observation?.eventId,
            body.eventId,
          );
        }
        if (name === "attemptMetadata")
          assert.equal(
            workflowRunResponse.parse(decoded).data.id,
            fixture.workflowRunId,
          );
        if (name === "attempts")
          assert(
            workflowRunsResponse
              .parse(decoded)
              .data.items.some((n) => n.id === fixture.workflowRunId),
          );
        if (name === "nodeHistory")
          assert(
            workflowNodeHistoryResponse
              .parse(decoded)
              .data.items.every(
                (n) =>
                  n.workflowRunId === fixture.workflowRunId &&
                  n.payload.nodeId === fixture.nodeIds[0],
              ),
          );
        if (ordinal >= 10) operations[operation].push(fact.ms);
      }
    }
    await server.stop();
    server = undefined;
    result.database = database(dir, fixture.workflowRunId);
    errors.save(save, "workflow query original database capture", true);
    const measuredInputs = result.requests.filter(
      (r) => r.operation === "workflowIngestion",
    );
    for (const fact of measuredInputs) {
      const input = workflowEventInput.parse(fact.input);
      const row: WorkflowDatabase["rows"][number] | undefined =
        result.database.rows.find((r) => r.event_id === input.eventId);
      assert(row);
      assert.equal(row.workflow_run_id, input.workflowRunId);
      assert.equal(row.sequence, input.sequence);
      assert.equal(row.digest, canonicalDigest(input));
      const { receivedAt, ...storedInput } = JSON.parse(row.body);
      assert.equal(typeof receivedAt, "string");
      assert.deepEqual(storedInput, input);
      assert.equal(row.acknowledgement, fact.responseText);
    }
    assert.equal(
      result.database.rows.length,
      fixture.lastSequence + samples + 10,
    );
    for (const [name, values] of Object.entries(operations)) {
      assert.equal(values.length, samples);
      const stats = distribution(values);
      result.operations[name] = stats;
      if (acceptance && stats.p95Ms >= 250)
        result.budgetFailures.push(
          `${index} ${name} workflow native p95>=250ms`,
        );
    }
    receipt.failures.push(...result.budgetFailures);
    assert.equal(
      result.budgetFailures.length,
      0,
      "workflow query budgets failed",
    );
    result.status = "finalized";
  } catch (error) {
    errors.capture("workflow query work", error);
  } finally {
    result.missing = Object.values(operations).reduce(
      (n, v) => n + samples - v.length,
      0,
    );
    errors.save(save, "workflow query before cleanup");
    await errors.attempt("workflow query server", async () => server?.stop());
    if (!result.database)
      await errors.attempt("workflow partial database", async () => {
        result.database = database(dir, fixture.workflowRunId);
      });
    errors.save(save, "workflow query after cleanup");
    errors.throwFirst();
  }
}
export async function visibilityScenario(
  index: number,
  fixture: WorkflowFixture,
  root: string,
  reports: number,
  acceptance: boolean,
  receipt: { visibility: unknown[]; failures: string[] },
  save: () => void,
) {
  const dir = join(root, `workflow-visible-${index}`);
  cpSync(fixture.dir, dir, { recursive: true });
  const expected = Array.from({ length: reports }, (_, ordinal) =>
    [0, 1].map((context) => ({
      context,
      projectId: fixture.projectId,
      workflowId: fixture.workflowId,
      revisionId: fixture.revisionId,
      workflowRunId: fixture.workflowRunId,
      nodeId: fixture.nodeIds[10 + ordinal],
      eventId: `unresolved-${index}-${ordinal}`,
    })),
  ).flat();
  const result = {
    index,
    status: "unfinalized",
    expected,
    observations: [] as (VisibleCapture & {
      observed?: unknown;
      otherEventIds?: string[];
    })[],
    invocations: [] as unknown[],
    transport: [] as {
      requestText: string;
      responseText: string;
      status: number;
      generation: string | null;
    }[],
    summary: null as ReturnType<typeof summarizeVisibility> | null,
    database: null as ReturnType<typeof database> | null,
    failure: "",
    qualification:
      "Finite real CLI dispatch through exact two-frame visible/hit-tested node evidence in two independent browser contexts, desktop1440/list and narrow375/list. Controller performance clock measures both endpoints; no server/browser clock subtraction. Process startup is included. Not sustained/burst or whole-v1 proof.",
  };
  receipt.visibility.push(result);
  const errors = proofErrors((error) => {
    result.failure = failureFact(error).message;
    result.status = "unfinalized";
  });
  Object.assign(result, { failureFacts: errors.facts });
  let server: Awaited<ReturnType<typeof launch>> | undefined,
    proxy: Awaited<ReturnType<typeof publicProxy>> | undefined,
    browser: Browser | undefined;
  const pages: Page[] = [];
  try {
    errors.save(save, "visible initial save", true);
    server = await launch({ dir });
    proxy = await publicProxy(server, (_request, body, reply) => {
      if (reply && body.length)
        result.transport.push({
          requestText: body.toString("utf8"),
          responseText: reply.body.toString("utf8"),
          status: reply.status,
          generation: reply.generation,
        });
      return undefined;
    });
    const inputs = join(root, `workflow-visible-inputs-${index}`);
    mkdirSync(inputs, { mode: 0o700 });
    const token = join(inputs, "token");
    writeFileSync(token, server.credentials().reporterToken, { mode: 0o600 });
    const env = {
      PORT: String(proxy.port),
      AGENTFLOW_REPORTER_TOKEN_FILE: token,
      AGENTFLOW_OUTBOX_DIR: join(inputs, "outbox"),
    };
    browser = await chromium.launch({
      channel:
        process.env.AGENTFLOW_TEST_BROWSER === "chrome" ? "chrome" : undefined,
    });
    const cookie = await pair(server);
    for (const context of [0, 1]) {
      const profile = await browser.newContext({
        viewport:
          context === 0
            ? { width: 1440, height: 1000 }
            : { width: 375, height: 812 },
      });
      await profile.addCookies([
        {
          name: "agentflow_session",
          value: cookie.slice(cookie.indexOf("=") + 1),
          url: server.url,
        },
      ]);
      const page = await profile.newPage();
      pages.push(page);
      const search = new URLSearchParams({
        workflowId: fixture.workflowId,
        revisionId: fixture.revisionId,
        workflowRunId: fixture.workflowRunId,
        nodeId: fixture.nodeIds[10],
        view: "list",
      });
      await page.goto(
        server.url + `/projects/${fixture.projectId}/workflows?${search}`,
      );
      await expect(
        page.getByText("Connected updates", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "Synthetic plan node 10",
          exact: true,
        }),
      ).toBeVisible();
    }
    for (let ordinal = 0; ordinal < reports; ordinal++) {
      const nodeId = fixture.nodeIds[10 + ordinal];
      for (const page of pages) {
        await page.locator(`button[data-node-id="${nodeId}"]`).click();
        await expect(
          page.getByRole("heading", {
            name: `Synthetic plan node ${10 + ordinal}`,
            exact: true,
          }),
        ).toBeVisible();
        await page
          .locator(".workflow-evidence")
          .evaluate((panel) => panel.scrollIntoView({ block: "start" }));
      }
      const payload = join(inputs, `payload-${ordinal}.json`);
      writeFileSync(payload, JSON.stringify({ nodeId, state: "running" }), {
        mode: 0o600,
      });
      const invocation = await invokeCli(
        process.cwd(),
        [
          "report",
          "--workflow-run",
          fixture.workflowRunId,
          "--type",
          "workflow.node.reported",
          "--payload",
          payload,
        ],
        env,
      );
      result.invocations.push({ ordinal, ...invocation });
      errors.save(save, "visible original CLI capture", true);
      assert.equal(invocation.code, 0, "workflow CLI report rejected");
      const ack = JSON.parse(invocation.stdout),
        original = result.transport.find(
          (r) => JSON.parse(r.requestText).eventId === ack.eventId,
        );
      assert(original, "original workflow report capture missing");
      const input = workflowEventInput.parse(JSON.parse(original.requestText)),
        reply = workflowEventResponse.parse(JSON.parse(original.responseText));
      assert.equal(reply.data.eventId, input.eventId);
      assert.equal(reply.data.workflowRunId, fixture.workflowRunId);
      assert.equal(
        reply.data.acceptedSequence,
        fixture.lastSequence + ordinal + 1,
      );
      assert(input.type === "workflow.node.reported");
      assert.equal(input.payload.nodeId, nodeId);
      const identities = expected.filter((e) => e.nodeId === nodeId);
      identities.forEach((e) => (e.eventId = input.eventId));
      const captures = await Promise.allSettled(
        pages.map(async (page, context) => {
          const identity = identities.find((e) => e.context === context)!;
          const raw = await page.evaluate(visibleFrames, {
            identity,
            maxWaitMs: 5000,
          });
          const capture = {
            ...identity,
            ...raw,
            elapsedMs: performance.now() - invocation.dispatchMs,
          };
          result.observations.push(capture);
          return capture;
        }),
      );
      errors.save(save, "visible original frame capture", true);
      for (const capture of captures)
        if (capture.status === "rejected") throw capture.reason;
    }
    await browser.close();
    browser = undefined;
    await server.stop();
    server = undefined;
    result.database = database(dir, fixture.workflowRunId);
    errors.save(save, "visible original database capture", true);
    for (const request of result.transport) {
      const input = workflowEventInput.parse(JSON.parse(request.requestText));
      const row: WorkflowDatabase["rows"][number] | undefined =
        result.database.rows.find((r) => r.event_id === input.eventId);
      assert(row);
      assert.equal(row.digest, canonicalDigest(input));
      const { receivedAt, ...storedInput } = JSON.parse(row.body);
      assert.equal(typeof receivedAt, "string");
      assert.deepEqual(storedInput, input);
      assert.equal(row.acknowledgement, request.responseText);
      assert.equal(row.sequence, input.sequence);
    }
    assert.equal(result.database.rows.length, fixture.lastSequence + reports);
    result.summary = summarizeVisibility(expected, result.observations);
    assert.equal(result.summary.expected, reports * 2);
    assert(
      result.summary.valid,
      "finite visible denominator has missing/wrong/duplicate/hidden evidence",
    );
    if (acceptance && result.summary.distribution!.p95Ms >= 2000) {
      receipt.failures.push(`${index} CLI→visible p95>=2s`);
      throw new Error("VISIBLE_BUDGET_FAILED");
    }
    result.status = "finalized";
  } catch (error) {
    errors.capture("visible work", error);
  } finally {
    result.summary = summarizeVisibility(expected, result.observations);
    errors.save(save, "visible before cleanup");
    await errors.attempt("visible browser", async () => browser?.close());
    await errors.attempt("visible proxy", async () => proxy?.close());
    await errors.attempt("visible server", async () => server?.stop());
    if (!result.database)
      await errors.attempt("visible partial database", async () => {
        result.database = database(dir, fixture.workflowRunId);
      });
    errors.save(save, "visible after cleanup");
    errors.throwFirst();
  }
}
