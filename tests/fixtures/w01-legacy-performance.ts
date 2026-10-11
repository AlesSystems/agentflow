import {
  boundedLaunch,
  boundedFetch,
  readBoundedText,
  boundedProxy,
} from "./w01-runtime";
import {
  captureEventSpool,
  capturePendingSpool,
  validateEventSpool,
} from "./w01-spool";
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
  entry = "src/cli/main.ts",
) {
  const dispatchMs = performance.now();
  const child = spawn(process.execPath, ["--import", "tsx", entry, ...args], {
    cwd: source,
    env: { ...process.env, ...env, FORCE_COLOR: undefined },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "",
    exitMs: number | null = null,
    exitCode: number | null = null,
    signal: string | null = null,
    timedOut = false,
    forcedDrain = false;
  const errors: ReturnType<typeof failureFact>[] = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  for (const stream of [child.stdout, child.stderr])
    stream.on("error", (error) => errors.push(failureFact(error)));
  child.once("error", (error) => errors.push(failureFact(error)));
  child.once("exit", (code, reason) => {
    exitMs = performance.now();
    exitCode = code;
    signal = reason;
  });
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
    drainTimer = setTimeout(() => {
      forcedDrain = true;
      child.stdout.destroy();
      child.stderr.destroy();
    }, 1000);
  }, 20000);
  const closeCode = await new Promise<number | null>((resolve) =>
    child.once("close", resolve),
  ).finally(() => {
    clearTimeout(timer);
    clearTimeout(drainTimer);
  });
  const drainedMs = performance.now(),
    completedMs = exitMs ?? drainedMs;
  return {
    dispatchMs,
    completedMs,
    exitMs,
    drainedMs,
    elapsedMs: completedMs - dispatchMs,
    elapsedEndpoint: exitMs === null ? "no-exit/drain" : "exit",
    code: timedOut || forcedDrain || errors.length ? null : closeCode,
    exitCode,
    signal,
    timedOut,
    forcedDrain,
    errors,
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
      "taskCreationDefaultFullHTTP",
      "taskCreatePreference",
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
    registrations: [] as {
      label: string;
      key: string;
      originalBytesBase64: string;
      sha256: string;
      body: unknown;
      digest: string;
    }[],
    eventSpool: [] as {
      label: string;
      capture: ReturnType<typeof captureEventSpool>;
    }[],
    pendingSpool: [] as {
      label: string;
      capture: ReturnType<typeof captureEventSpool>;
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
    proxyFailures: {} as Record<
      string,
      Awaited<ReturnType<typeof boundedProxy>>["failures"]
    >,
    missing: 5 * 2 * samples,
    failure: "",
    budgetFailures: [] as string[],
    qualification:
      "Same complete dataset and CLI task producer semantics. Default task creation is direct native HTTP without Prefer and retains the original full response in both sources. Actual CLI task creation includes its durable registration publication and full fallback/Prefer:minimal behavior. Real CLI online/queue/flush use the same bounded loopback capture proxy for complete decoded ACK text, not wire bytes. Queue timing holds the native delivery lease and requires durable exit2; flush sends that exact one-event prefix. CLI wall timing includes process startup, local publication, requests, retries/backoff and exit; it has a 20-second kill bound and <=20% relative p95 regression gate, not the native HTTP 250ms absolute budget. Each CLI source retains its native 5-second delivery deadline.",
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
      const server = (servers[label] = await boundedLaunch({
        dir,
        cwd: sources[label],
      }));
      proxies[label] = await boundedProxy(server, (request, body, reply) => {
        if (!reply && request.url?.endsWith("/events")) {
          const input = JSON.parse(body.toString("utf8"));
          const capture = captureEventSpool(
            configs[label]!.outbox,
            { kind: "run", id: input.runId },
            input,
          );
          result.eventSpool.push({ label, capture });
          validateEventSpool(capture, input);
        }
        if (!reply && request.url === "/api/v1/tasks") {
          const key = String(request.headers["idempotency-key"]),
            path = join(configs[label]!.outbox, `registration-${key}.json`),
            bytes = readFileSync(path),
            record = JSON.parse(bytes.toString("utf8"));
          result.registrations.push({
            label,
            key,
            originalBytesBase64: bytes.toString("base64"),
            sha256: hash(bytes),
            body: record.body,
            digest: record.digest,
          });
        }
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
      result.proxyFailures[label] = proxies[label]!.failures;
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
        const response = await boundedFetch(server.url + "/api/v1/tasks", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + server.credentials().reporterToken,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify(taskInput),
        });
        const taskCapture = {
          operation: "taskCreationDefaultFullHTTP",
          label,
          ordinal,
          warmup: ordinal < 10,
          input: taskInput,
          dispatchMs,
          completedMs: null as number | null,
          elapsedMs: null as number | null,
          status: response.status,
          responseText: "",
          generation: response.headers.get("agentflow-generation"),
        };
        result.samples.push(taskCapture);
        const responseText = await readBoundedText(
            response,
            (text) => (taskCapture.responseText = text),
          ),
          completedMs = performance.now();
        taskCapture.completedMs = completedMs;
        taskCapture.elapsedMs = completedMs - dispatchMs;
        assert.equal(response.status, 201);
        const task = taskResponse.parse(JSON.parse(responseText));
        assert.equal(response.headers.get("preference-applied"), null);
        assert.equal(task.data.projectId, prepared.seed.projectId);
        assert.equal(task.data.version, 1);
        assert.equal(task.data.workRevision, 1);
        if (ordinal >= 10)
          operations.taskCreationDefaultFullHTTP[label].push(
            completedMs - dispatchMs,
          );
        const cliTaskBody = {
            projectId: prepared.seed.projectId,
            title: `Synthetic CLI measured task ${ordinal}`,
          },
          key = randomUUID(),
          file = join(inputDir, `task-${ordinal}.json`);
        writeFileSync(file, JSON.stringify(cliTaskBody), { mode: 0o600 });
        const created = await invokeCli(
          sources[label],
          ["task", "create", "--file", file, "--idempotency-key", key],
          env,
        );
        result.samples.push({
          operation: "taskCreatePreference",
          label,
          ordinal,
          warmup: ordinal < 10,
          input: cliTaskBody,
          key,
          ...created,
        });
        assert.equal(created.code, 0, "actual CLI task creation rejected");
        const taskAck = JSON.parse(created.stdout),
          original = result.transport.find(
            (t) =>
              t.label === label &&
              t.path === "/api/v1/tasks" &&
              JSON.parse(t.requestText).title === cliTaskBody.title,
          );
        assert(original);
        const reply =
          label === "head"
            ? taskRegistrationResponse.parse(JSON.parse(original.responseText))
            : taskResponse.parse(JSON.parse(original.responseText));
        assert.equal(reply.data.id, taskAck.id);
        assert.equal(reply.data.projectId, prepared.seed.projectId);
        assert.equal(reply.data.version, 1);
        assert.equal(reply.data.workRevision, 1);
        const registration = result.registrations.find(
          (r) => r.label === label && r.key === key,
        );
        assert(registration);
        assert.deepEqual(registration.body, cliTaskBody);
        assert.equal(registration.digest, canonicalDigest(cliTaskBody));
        if (ordinal >= 10)
          operations.taskCreatePreference[label].push(created.elapsedMs);
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
        result.pendingSpool.push(
          ...capturePendingSpool(config.outbox, {
            kind: "run",
            id: prepared.seed.runs[0],
          }).map((capture) => ({ label, capture })),
        );
        assert.equal(queued.code, 2, "lease-held report must remain durable");
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
          name === "taskCreationDefaultFullHTTP" &&
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
            "SELECT id,project_id,title,version,work_revision FROM tasks WHERE title LIKE 'Synthetic measured task %' OR title LIKE 'Synthetic CLI measured task %' ORDER BY title",
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
        assert.equal(tasks.length, (samples + 10) * 2);
        for (const sample of result.samples as {
          operation: string;
          label: string;
          responseText?: string;
          input?: { title: string };
        }[])
          if (
            sample.operation === "taskCreationDefaultFullHTTP" &&
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
        for (const sample of result.samples as {
          operation: string;
          label: string;
          stdout?: string;
          input?: { title: string };
        }[])
          if (
            sample.operation === "taskCreatePreference" &&
            sample.label === label
          ) {
            const id = JSON.parse(sample.stdout!).id;
            const task = tasks.find((t) => t.id === id);
            assert(task);
            assert.equal(task.title, sample.input!.title);
            assert.equal(task.project_id, prepared.seed.projectId);
            assert.equal(task.version, 1);
            assert.equal(task.work_revision, 1);
          }
        assert.equal(
          result.registrations.filter((r) => r.label === label).length,
          samples + 10,
        );
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
          const spool = result.eventSpool.find(
            (s) =>
              s.label === label && s.capture.body?.eventId === input.eventId,
          );
          assert(spool, "actual preforward spool missing");
          validateEventSpool(spool.capture, input);
          assert.deepEqual(spool.capture.body, storedInput);
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
    for (const label of labels)
      if (configs[label])
        await errors.attempt("legacy pending spool " + label, async () => {
          result.pendingSpool.push(
            ...capturePendingSpool(configs[label]!.outbox, {
              kind: "run",
              id: prepared.seed.runs[0],
            }).map((capture) => ({ label, capture })),
          );
        });
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
                  "SELECT id,project_id,title,version,work_revision FROM tasks WHERE title LIKE 'Synthetic measured task %' OR title LIKE 'Synthetic CLI measured task %' ORDER BY title",
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
