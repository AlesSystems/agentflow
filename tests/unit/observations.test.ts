import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  eventInput,
  runRegister,
  type Run,
} from "../../src/contracts/observations";
import {
  decideEvent,
  decideClose,
  observationFreshness,
} from "../../src/domain/runs";
const run: Run = {
  id: randomUUID(),
  projectId: randomUUID(),
  agentId: randomUUID(),
  taskId: null,
  purpose: "planning",
  model: null,
  workRevision: null,
  state: "queued",
  lastSequence: 0,
  lastReceivedAt: "1970-01-01T00:00:01.000Z",
  startedAt: null,
  endedAt: null,
  version: 1,
  createdAt: "1970-01-01T00:00:01.000Z",
};
const event = (type = "run.started", sequence = 1, payload: unknown = {}) => ({
  schemaVersion: 1,
  eventId: randomUUID(),
  runId: run.id,
  sequence,
  type,
  occurredAt: "2099-01-01T00:00:00+03:00",
  payload,
});
it.each([
  ["queued", 0, 61000, false, "no_report_received"],
  ["queued", 0, 61001, true, "stale"],
  ["running", 1, 61000, false, "fresh"],
  ["running", 1, 61001, true, "stale"],
  ["succeeded", 1, 999999, false, "terminal"],
  ["interrupted", 0, 999999, false, "terminal"],
] as const)(
  "uses receive-time freshness at exact boundary %s %s %s",
  (state, lastSequence, now, stale, reporting) =>
    expect(observationFreshness({ ...run, state, lastSequence }, now)).toEqual({
      stale,
      reporting,
    }),
);
it.each(["run.heartbeat", "run.progress", "run.succeeded", "run.failed"])(
  "rejects queued %s",
  (type) =>
    expect(() =>
      decideEvent(
        run,
        eventInput.parse(
          event(
            type,
            1,
            type === "run.progress" || type === "run.failed"
              ? { message: "x" }
              : type === "run.succeeded"
                ? { summary: "x" }
                : {},
          ),
        ),
        null,
        1000,
      ),
    ).toThrow("run_transition_invalid"),
);
it.each(["succeeded", "failed", "cancelled", "interrupted"] as const)(
  "never regresses terminal %s",
  (state) => {
    expect(() =>
      decideEvent({ ...run, state }, eventInput.parse(event()), null, 1000),
    ).toThrow("run_terminal");
    expect(() =>
      decideEvent(
        { ...run, state },
        eventInput.parse(event("run.started", 2)),
        null,
        1000,
      ),
    ).toThrow("sequence_gap");
  },
);
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid sequence %s",
  (sequence) =>
    expect(eventInput.safeParse(event("run.started", sequence)).success).toBe(
      false,
    ),
);
it.each([-1, 101, 0.5])("rejects invalid percent %s", (percent) =>
  expect(
    eventInput.safeParse(event("run.progress", 1, { message: "x", percent }))
      .success,
  ).toBe(false),
);
it.each([0, 100])("accepts advisory integer percent %s", (percent) =>
  expect(
    eventInput.safeParse(event("run.progress", 1, { message: "x", percent }))
      .success,
  ).toBe(true),
);
it.each([
  { message: "" },
  { message: "x".repeat(4001) },
  { message: "x", percent: 1, unknown: 1 },
])("rejects malformed progress payload", (payload) =>
  expect(eventInput.safeParse(event("run.progress", 1, payload)).success).toBe(
    false,
  ),
);
it("bounds payload URLs and failure codes and normalizes offset timestamps", () => {
  expect(eventInput.parse(event()).occurredAt).toBe("2098-12-31T21:00:00.000Z");
  for (const evidenceUrl of [
    "javascript:alert(1)",
    "https://user:secret@example.com",
    "https://example.com/" + "x".repeat(2000),
  ])
    expect(
      eventInput.safeParse(
        event("run.succeeded", 1, { summary: "x", evidenceUrl }),
      ).success,
    ).toBe(false);
  expect(
    eventInput.safeParse(
      event("run.failed", 1, { message: "x", code: "x".repeat(101) }),
    ).success,
  ).toBe(false);
  expect(eventInput.safeParse({ ...event(), schemaVersion: 2 }).success).toBe(
    false,
  );
  expect(eventInput.safeParse({ ...event(), state: "running" }).success).toBe(
    false,
  );
});
it("close needs stale active matching version and preserves producer sequence", () => {
  expect(() => decideClose(run, 1, 61000)).toThrow("run_not_stale");
  expect(() => decideClose(run, 2, 61001)).toThrow("version_conflict");
  expect(decideClose(run, 1, 61001)).toMatchObject({
    state: "interrupted",
    lastSequence: 0,
    lastReceivedAt: run.lastReceivedAt,
    version: 2,
    endedAt: "1970-01-01T00:01:01.001Z",
  });
});
it("registration excludes unowned taskless and projection fields", () => {
  const input = {
    id: run.id,
    projectId: run.projectId,
    agentId: run.agentId,
    purpose: "planning",
  };
  expect(runRegister.safeParse(input).success).toBe(true);
  for (const patch of [
    { purpose: "implementation" },
    { expectedTaskVersion: 1 },
    { workRevision: 1 },
    { state: "running" },
    { registrationOrder: 1 },
    { taskId: randomUUID() },
  ])
    expect(runRegister.safeParse({ ...input, ...patch }).success).toBe(false);
});
it("preserves immutable legacy UUID casing when validating raw event-history output", async () => {
  const { eventRecord } = await import("../../src/contracts/observations");
  const record = {
    ...event(),
    eventId: "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC",
    runId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
    occurredAt: "2026-10-10T00:00:00.000Z",
    receivedAt: "2026-10-10T00:00:01.000Z",
  };
  expect(eventRecord.parse(record)).toEqual(record);
});
