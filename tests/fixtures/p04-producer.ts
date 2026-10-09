import { randomUUID } from "node:crypto";
const url = process.env.AGENTFLOW_PRODUCER_URL!;
const token = process.env.AGENTFLOW_PRODUCER_TOKEN!;
const records: unknown[] = [];
async function call(path: string, input?: unknown, key = randomUUID()) {
  const response = await fetch(url + "/api/v1" + path, {
    method: input ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(path.endsWith("/events") ? {} : { "Idempotency-Key": key }),
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const body = await response.json();
  records.push({
    path,
    request: input ?? null,
    status: response.status,
    body,
    currentGeneration: response.headers.get("AgentFlow-Generation"),
  });
  return { status: response.status, body };
}
const projectId = (
  await call("/projects", { name: "Synthetic external producer" })
).body.data.id;
const taskId = (
  await call("/tasks", { projectId, title: "Synthetic external producer" })
).body.data.id;
const agentId = (
  await call("/agents", {
    displayName: "Synthetic external producer",
    source: "deterministic fixture subprocess",
    defaultRole: "implementation",
  })
).body.data.id;
const runId = randomUUID();
await call("/runs", {
  id: runId,
  projectId,
  taskId,
  agentId,
  purpose: "implementation",
  expectedTaskVersion: 1,
});
const events = [
  ["run.started", {}],
  ["run.heartbeat", {}],
  ["run.progress", { message: "Synthetic progress", percent: 50 }],
  [
    "run.succeeded",
    {
      summary: "Synthetic artifact complete",
      evidenceUrl: "https://example.com/synthetic",
    },
  ],
].map(([type, payload], i) => ({
  schemaVersion: 1,
  eventId: randomUUID(),
  runId,
  sequence: i + 1,
  type,
  occurredAt: "2026-10-10T00:00:00Z",
  payload,
}));
for (const event of events) await call(`/runs/${runId}/events`, event);
await call(`/runs/${runId}/events`, events[1]);
await call(`/runs/${runId}/events`, {
  ...events[1],
  payload: { unknown: true },
});
await call(`/runs/${runId}/events`, {
  ...events[3],
  eventId: randomUUID(),
  sequence: 5,
  type: "run.failed",
  payload: { message: "invalid terminal regression" },
});
const detail = await call("/tasks/" + taskId);
const reviewId = randomUUID();
await call("/runs", {
  id: reviewId,
  projectId,
  taskId,
  agentId,
  purpose: "verification",
  expectedTaskVersion: detail.body.data.task.version,
});
for (const [type, payload, sequence] of [
  ["run.started", {}, 1],
  [
    "run.succeeded",
    { summary: "Synthetic independent verification report" },
    2,
  ],
] as const)
  await call(`/runs/${reviewId}/events`, {
    schemaVersion: 1,
    eventId: randomUUID(),
    runId: reviewId,
    sequence,
    type,
    occurredAt: "2026-10-10T00:00:00Z",
    payload,
  });
await call("/tasks/" + taskId);
console.log(JSON.stringify({ schemaVersion: 1, synthetic: true, records }));
if (
  records.some((value) => {
    const r = value as { status: number };
    return ![200, 201, 409, 422].includes(r.status);
  })
)
  process.exitCode = 1;
