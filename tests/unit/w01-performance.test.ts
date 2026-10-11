import { proofErrors } from "../fixtures/p07-proof-errors";
import { describe, expect, it } from "vitest";
import {
  summarizeVisibility,
  visibilityBudgetFailures,
  viewDistributions,
  distribution,
  type VisibleIdentity,
} from "../fixtures/w01-capture";
const id = (eventId: string): VisibleIdentity => ({
  projectId: "project",
  workflowId: "workflow",
  revisionId: "revision",
  workflowRunId: "attempt",
  nodeId: "node",
  eventId,
});
describe("W01 finite performance capture", () => {
  it("retains the complete denominator and exposes every absent/duplicate/wrong/hidden/late observation", () => {
    const expected = Array.from({ length: 30 }, (_, n) =>
      [0, 1].map((context) => ({ context, ...id(String(n)) })),
    ).flat();
    const captured = expected.slice(0, 59).map((e, n) => ({
      ...e,
      elapsedMs: n === 0 ? 2000 : 10,
      frames: 2,
      exact: n !== 1,
      visible: n !== 2,
      hitTest: n !== 2,
      matched: 1,
      wrong: n === 1 ? 1 : 0,
    }));
    const facts = summarizeVisibility(expected, [...captured, captured[3]]);
    expect(facts.expected).toBe(60);
    expect(facts.captured).toBe(60);
    expect(facts.missing).toBe(1);
    expect(facts.duplicate).toBe(1);
    expect(facts.wrong).toBe(1);
    expect(facts.hidden).toBe(1);
    expect(facts.late).toBe(1);
    expect(facts.valid).toBe(false);
  });
  it("checks identities instead of accepting a correct event under another workflow attempt", () => {
    const expected = [{ context: 0, ...id("event") }];
    const capture = [
      {
        ...expected[0],
        workflowRunId: "wrong-attempt",
        elapsedMs: 1,
        frames: 2,
        exact: true,
        visible: true,
        hitTest: true,
        matched: 1,
        wrong: 0,
      },
    ];
    expect(summarizeVisibility(expected, capture)).toMatchObject({
      wrong: 1,
      missing: 1,
      valid: false,
    });
  });
  it("keeps p95 raw samples and rejects non-finite or empty measurements", () => {
    expect(
      distribution(Array.from({ length: 100 }, (_, n) => n + 1)),
    ).toMatchObject({ count: 100, p95Ms: 95 });
    expect(() => distribution([])).toThrow();
    expect(() => distribution([Number.NaN])).toThrow();
  });
});

it("preserves the first work failure and original capture while attempting every cleanup and recording secondary failures", async () => {
  const original = new Error("original report rejected"),
    secondary = new Error("cleanup failed");
  const receipt = {
    raw: "original decoded ACK bytes",
    primary: "",
    cleanup: [] as string[],
  };
  const errors = proofErrors(
    (error) => (receipt.primary = (error as Error).message),
  );
  errors.capture("work", original);
  await errors.attempt("first cleanup", async () => {
    receipt.cleanup.push("first");
    throw secondary;
  });
  await errors.attempt("second cleanup", async () => {
    receipt.cleanup.push("second");
  });
  let saved = "";
  errors.save(() => (saved = JSON.stringify(receipt)), "failure snapshot");
  expect(() => errors.throwFirst()).toThrow(original);
  expect(JSON.parse(saved)).toEqual({
    raw: "original decoded ACK bytes",
    primary: original.message,
    cleanup: ["first", "second"],
  });
  expect(errors.facts.errors.map((f) => f.error.message)).toEqual([
    original.message,
    secondary.message,
  ]);
});

it("rejects a complete late-only visibility denominator at the exact two-second boundary", () => {
  const expected = [
    { context: 0, ...id("late"), view: "graph" },
    { context: 1, ...id("list"), view: "list" },
  ];
  const captured = expected.map((e) => ({
    ...e,
    elapsedMs: e.context === 0 ? 2000 : 10,
    frames: 2,
    exact: true,
    visible: true,
    hitTest: true,
    matched: 1,
    wrong: 0,
  }));
  const summary = summarizeVisibility(expected, captured);
  expect(summary).toMatchObject({
    missing: 0,
    duplicate: 0,
    wrong: 0,
    hidden: 0,
    late: 1,
    valid: false,
  });
});
it("exposes slow graph samples even when every scenario and pooled p95 hides them", () => {
  const expected = Array.from({ length: 30 }, (_, n) =>
    [0, 1].map((context) => ({
      context,
      ...id(String(n)),
      view: context === 0 ? "graph" : "list",
    })),
  ).flat();
  const captured = expected.map((e) => ({
    ...e,
    elapsedMs:
      e.context === 0 && [0, 10, 20].includes(Number(e.eventId)) ? 2100 : 100,
    frames: 2,
    exact: true,
    visible: true,
    hitTest: true,
    matched: 1,
    wrong: 0,
  }));
  const summary = summarizeVisibility(expected, captured),
    views = viewDistributions(captured);
  expect(summary.distribution!.p95Ms).toBe(100);
  expect(views.graph.p95Ms).toBe(2100);
  const failures = visibilityBudgetFailures(summary, views, 60);
  expect(failures).toContain("late visibility observations");
  expect(failures).toContain("graph visibility p95 >=2s");
  expect(summary.valid).toBe(false);
});
