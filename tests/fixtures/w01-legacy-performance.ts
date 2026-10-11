import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { canonicalDigest } from "../../src/domain/request-digest";
import { taskResponse } from "../../src/contracts/responses";
import { taskRegistrationResponse } from "../../src/contracts/task-registration";
import { eventInput, eventResponse } from "../../src/contracts/observations";
import type { openOutbox } from "../../src/cli/outbox";
import { launch } from "./server";
import { publicProxy } from "./p06-proxy";
import { proofErrors } from "./p07-proof-errors";
import { failureFact } from "./p07-warm-error";
import { distribution } from "./w01-capture";
import { hash, type Prepared } from "./w01-performance-fixture";
export async function invokeCli(
  source: string,
  args: string[],
  env: Record<string, string>,
) {
  const dispatchMs = performance.now();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/cli/main.ts", ...args],
    {
      cwd: source,
      env: { ...process.env, ...env, FORCE_COLOR: undefined },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  }).finally(() => clearTimeout(timer));
  const completedMs = performance.now();
  return {
    dispatchMs,
    completedMs,
    elapsedMs: completedMs - dispatchMs,
    code,
    stdout,
    stderr,
  };
}
export async function legacyCompare(
  index: number,
  prepared: Prepared,
  root: string,
  samples: number,
  acceptance: boolean,
  receipt: { legacy: unknown[]; failures: string[] },
  save: () => void,
) {
  const labels =
    index % 2 ? (["base", "head"] as const) : (["head", "base"] as const);
  const operations = Object.fromEntries(
    [
      "taskCreationHTTP",
      "legacyOnlineReport",
      "legacyDurableQueue",
      "legacyFlushSingle",
    ].map((name) => [name, { base: [] as number[], head: [] as number[] }]),
  );
  const result = {
    index,
    status: "unfinalized",
    order: labels,
    operations: {} as Record<string, unknown>,
    samples: [] as unknown[],
    transport: [] as {
      label: string;
      path: string;
      requestText: string;
      status: number;
      responseText: string;
      generation: string | null;
    }[],
    queue: [] as {
      label: string;
      filename: string;
      originalBytesBase64: string;
      sha256: string;
      body: unknown;
      digest: string;
    }[],
    database: {} as Record<string, unknown>,
    missing: 4 * 2 * samples,
    failure: "",
    budgetFailures: [] as string[],
    qualification:
      "Same complete dataset and CLI task producer semantics. HTTP task creation is direct native HTTP with identical Prefer:return=minimal; baseline ignores it and returns full original task. Real CLI online/queue/flush use the same bounded loopback capture proxy for complete decoded ACK text, not wire bytes. Queue timing holds the native delivery lease and requires durable exit2; flush sends that exact one-event prefix. CLI wall timing includes process startup, local publication, requests, retries/backoff and exit; it has a 20-second kill bound and <=20% relative p95 regression gate, not the native HTTP 250ms absolute budget. Each CLI source retains its native 5-second delivery deadline.",
  };
  receipt.legacy.push(result);
  const errors = proofErrors((error) => {
    result.failure = failureFact(error).message;
    result.status = "unfinalized";
  });
  Object.assign(result, { failureFacts: errors.facts });
  const servers: Partial<
      Record<"base" | "head", Awaited<ReturnType<typeof launch>>>
    > = {},
    proxies: Partial<
      Record<"base" | "head", Awaited<ReturnType<typeof publicProxy>>>
    > = {},
    leases: Partial<
      Record<"base" | "head", Awaited<ReturnType<typeof openOutbox>>>
    > = {};
  const configs: Partial<
      Record<
        "base" | "head",
        {
          port: number;
          token: string;
          outbox: string;
          explicitService: undefined;
        }
      >
    > = {},
    sources = { base: prepared.baseSource, head: prepared.headSource };
  const loaders: Partial<Record<"base" | "head", typeof openOutbox>> = {};
  try {
    errors.save(save, "legacy initial save", true);
    for (const label of labels) {
      const dir = join(root, `legacy-${index}-${label}`);
      cpSync(prepared.seedDir, dir, { recursive: true });
      const server = (servers[label] = await launch({
        dir,
        cwd: sources[label],
      }));
      proxies[label] = await publicProxy(server, (request, body, reply) => {
        if (reply)
          result.transport.push({
            label,
            path: request.url ?? "",
            requestText: body.toString("utf8"),
            status: reply.status,
            responseText: reply.body.toString("utf8"),
            generation: reply.generation,
          });
        return undefined;
      });
      const inputs = join(root, `legacy-inputs-${index}-${label}`);
      mkdirSync(inputs, { mode: 0o700 });
      const token = join(inputs, "token");
      writeFileSync(token, server.credentials().reporterToken, { mode: 0o600 });
      writeFileSync(join(inputs, "empty.json"), "{}", { mode: 0o600 });
      configs[label] = {
        port: proxies[label]!.port,
        token: server.credentials().reporterToken,
        outbox: join(inputs, "outbox"),
        explicitService: undefined,
      };
      loaders[label] = (
        await import(
          pathToFileURL(join(sources[label], "src/cli/outbox.ts")).href
        )
      ).openOutbox;
    }
    for (let ordinal = 0; ordinal < samples + 10; ordinal++)
      for (const label of ordinal % 2 ? [...labels].reverse() : labels) {
        const server = servers[label]!,
          config = configs[label]!,
          inputDir = join(root, `legacy-inputs-${index}-${label}`),
          env = {
            PORT: String(config.port),
            AGENTFLOW_REPORTER_TOKEN_FILE: join(inputDir, "token"),
            AGENTFLOW_OUTBOX_DIR: config.outbox,
          };
        const taskInput = {
          projectId: prepared.seed.projectId,
          title: `Synthetic measured task ${ordinal}`,
        };
        const dispatchMs = performance.now();
        const response = await fetch(server.url + "/api/v1/tasks", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + server.credentials().reporterToken,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
            Prefer: "return=minimal",
          },
          body: JSON.stringify(taskInput),
        });
        const responseText = await response.text(),
          completedMs = performance.now();
        result.samples.push({
          operation: "taskCreationHTTP",
          label,
          ordinal,
          warmup: ordinal < 10,
          input: taskInput,
          dispatchMs,
          completedMs,
          elapsedMs: completedMs - dispatchMs,
          status: response.status,
          responseText,
          generation: response.headers.get("agentflow-generation"),
        });
        assert.equal(response.status, 201);
        const task =
          label === "head"
            ? taskRegistrationResponse.parse(JSON.parse(responseText))
            : taskResponse.parse(JSON.parse(responseText));
        assert.equal(task.data.projectId, prepared.seed.projectId);
        assert.equal(task.data.version, 1);
        assert.equal(task.data.workRevision, 1);
        if (ordinal >= 10)
          operations.taskCreationHTTP[label].push(completedMs - dispatchMs);
        const args = [
          "report",
          "--run",
          prepared.seed.runs[0],
          "--type",
          ordinal === 0 ? "run.started" : "run.heartbeat",
          "--payload",
          join(inputDir, "empty.json"),
        ];
        const online = await invokeCli(sources[label], args, env);
        result.samples.push({
          operation: "legacyOnlineReport",
          label,
          ordinal,
          warmup: ordinal < 10,
          ...online,
        });
        assert.equal(online.code, 0, "legacy online delivery failed");
        const ack = JSON.parse(online.stdout);
        assert.equal(ack.runId, prepared.seed.runs[0]);
        assert.equal(ack.acceptedSequence, ordinal * 2 + 1);
        if (ordinal >= 10)
          operations.legacyOnlineReport[label].push(online.elapsedMs);
        const lease = (leases[label] = await loaders[label]!(
          config,
          performance.now() + 5000,
        ));
        assert(lease.acquireDelivery(), "native queue-control lease required");
        const queued = await invokeCli(
          sources[label],
          [...args.slice(0, 4), "run.heartbeat", ...args.slice(5)],
          env,
        );
        result.samples.push({
          operation: "legacyDurableQueue",
          label,
          ordinal,
          warmup: ordinal < 10,
          ...queued,
        });
        assert.equal(queued.code, 2, "lease-held report must remain durable");
        const leaf = join(config.outbox, prepared.seed.runs[0]);
        const names = readdirSync(leaf).filter((name) =>
          /^\d+-.*\.json$/.test(name),
        );
        const originals = names.map((filename) => {
          const bytes = readFileSync(join(leaf, filename)),
            record = JSON.parse(bytes.toString("utf8"));
          const fact = {
            label,
            filename,
            originalBytesBase64: bytes.toString("base64"),
            sha256: hash(bytes),
            body: record.body,
            digest: record.digest,
          };
          result.queue.push(fact);
          return fact;
        });
        assert.equal(originals.length, 1);
        const event = eventInput.parse(originals[0].body);
        assert.equal(event.runId, prepared.seed.runs[0]);
        assert.equal(event.sequence, ordinal * 2 + 2);
        assert.equal(originals[0].digest, canonicalDigest(event));
        if (ordinal >= 10)
          operations.legacyDurableQueue[label].push(queued.elapsedMs);
        lease.close();
        delete leases[label];
        const flushed = await invokeCli(
          sources[label],
          ["flush", "--run", prepared.seed.runs[0]],
          env,
        );
        result.samples.push({
          operation: "legacyFlushSingle",
          label,
          ordinal,
          warmup: ordinal < 10,
          ...flushed,
        });
        assert.equal(flushed.code, 0, "legacy one-event flush failed");
        const flushedAck = JSON.parse(flushed.stdout);
        assert.equal(flushedAck.eventId, event.eventId);
        assert.equal(flushedAck.acceptedSequence, event.sequence);
        assert.equal(flushedAck.runId, event.runId);
        assert.equal(
          readdirSync(leaf).filter((name) => /^\d+-.*\.json$/.test(name))
            .length,
          0,
        );
        if (ordinal >= 10)
          operations.legacyFlushSingle[label].push(flushed.elapsedMs);
      }
    for (const [name, values] of Object.entries(operations)) {
      assert.equal(values.base.length, samples);
      assert.equal(values.head.length, samples);
      const base = distribution(values.base),
        head = distribution(values.head),
        p95ChangePercent = (head.p95Ms / base.p95Ms - 1) * 100;
      result.operations[name] = { base, head, p95ChangePercent };
      if (acceptance) {
        if (
          name === "taskCreationHTTP" &&
          (base.p95Ms >= 250 || head.p95Ms >= 250)
        )
          result.budgetFailures.push(`${index} ${name} native HTTP p95>=250ms`);
        if (p95ChangePercent > 20)
          result.budgetFailures.push(
            `${index} ${name} regression ${p95ChangePercent}%>20%`,
          );
      }
    }
    result.missing = 0;
    for (const label of labels) {
      await servers[label]!.stop();
      delete servers[label];
      const db = new Database(
        join(root, `legacy-${index}-${label}`, "agentflow.sqlite"),
        { readonly: true },
      );
      try {
        const rows = db
          .prepare(
            "SELECT event_id,run_id,sequence,digest,body,acknowledgement FROM run_events WHERE run_id=? ORDER BY sequence",
          )
          .all(prepared.seed.runs[0]) as {
          event_id: string;
          run_id: string;
          sequence: number;
          digest: string;
          body: string;
          acknowledgement: string;
        }[];
        const tasks = db
          .prepare(
            "SELECT id,project_id,title,version,work_revision FROM tasks WHERE title LIKE 'Synthetic measured task %' ORDER BY title",
          )
          .all() as {
          id: string;
          project_id: string;
          title: string;
          version: number;
          work_revision: number;
        }[];
        result.database[label] = {
          tasks,
          rows,
          integrity: db.pragma("integrity_check"),
          foreignKeys: db.pragma("foreign_key_check"),
        };
        errors.save(save, "legacy original database capture", true);
        assert.equal(rows.length, (samples + 10) * 2);
        assert.equal(tasks.length, samples + 10);
        for (const sample of result.samples as {
          operation: string;
          label: string;
          responseText?: string;
          input?: { title: string };
        }[])
          if (
            sample.operation === "taskCreationHTTP" &&
            sample.label === label
          ) {
            const id = JSON.parse(sample.responseText!).data.id;
            const task = tasks.find((t) => t.id === id);
            assert(task);
            assert.equal(task.title, sample.input!.title);
            assert.equal(task.project_id, prepared.seed.projectId);
            assert.equal(task.version, 1);
            assert.equal(task.work_revision, 1);
          }
        for (const row of rows) {
          const ack = eventResponse.parse(JSON.parse(row.acknowledgement));
          assert.equal(ack.data.eventId, row.event_id);
          assert.equal(ack.data.runId, row.run_id);
          assert.equal(ack.data.acceptedSequence, row.sequence);
          const transport = result.transport.find(
            (t) =>
              t.label === label &&
              t.path === `/api/v1/runs/${row.run_id}/events` &&
              JSON.parse(t.requestText).eventId === row.event_id,
          );
          assert(transport, "missing raw original ACK");
          assert.equal(transport.responseText, row.acknowledgement);
          const input = eventInput.parse(JSON.parse(transport.requestText));
          const { receivedAt, ...storedInput } = JSON.parse(row.body);
          assert.equal(typeof receivedAt, "string");
          assert.deepEqual(storedInput, input);
          assert.equal(row.digest, canonicalDigest(input));
          assert.equal(ack.generation, transport.generation);
          const queued = result.queue.find(
            (q) =>
              q.label === label &&
              (q.body as { eventId: string }).eventId === input.eventId,
          );
          if (queued) {
            assert.deepEqual(queued.body, input);
            assert.equal(queued.digest, row.digest);
            assert.equal(
              hash(Buffer.from(queued.originalBytesBase64, "base64")),
              queued.sha256,
            );
          }
        }
      } finally {
        db.close();
      }
    }
    receipt.failures.push(...result.budgetFailures);
    assert.equal(result.budgetFailures.length, 0, "legacy budgets failed");
    result.status = "finalized";
  } catch (error) {
    errors.capture("legacy work", error);
  } finally {
    result.missing = Object.values(operations).reduce(
      (n, v) => n + 2 * samples - v.base.length - v.head.length,
      0,
    );
    errors.save(save, "legacy before cleanup");
    for (const label of labels) {
      await errors.attempt("legacy lease " + label, async () =>
        leases[label]?.close(),
      );
      await errors.attempt("legacy proxy " + label, async () =>
        proxies[label]?.close(),
      );
      await errors.attempt("legacy server " + label, async () =>
        servers[label]?.stop(),
      );
      if (!result.database[label])
        await errors.attempt("legacy partial database " + label, async () => {
          const db = new Database(
            join(root, `legacy-${index}-${label}`, "agentflow.sqlite"),
            { readonly: true },
          );
          try {
            result.database[label] = {
              rows: db
                .prepare(
                  "SELECT event_id,run_id,sequence,digest,body,acknowledgement FROM run_events WHERE run_id=? ORDER BY sequence",
                )
                .all(prepared.seed.runs[0]),
              tasks: db
                .prepare(
                  "SELECT id,project_id,title,version,work_revision FROM tasks WHERE title LIKE 'Synthetic measured task %' ORDER BY title",
                )
                .all(),
              integrity: db.pragma("integrity_check"),
              foreignKeys: db.pragma("foreign_key_check"),
            };
          } finally {
            db.close();
          }
        });
    }
    errors.save(save, "legacy after cleanup");
    errors.throwFirst();
  }
}
