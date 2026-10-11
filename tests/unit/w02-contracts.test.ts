import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { runRegister, eventInput } from "../../src/contracts/observations";
import * as evidence from "../../src/contracts/evidence";
import { validateDependencies, deriveReadiness } from "../../src/workflows/dependencies";
const registration = { id: randomUUID(), projectId: randomUUID(), agentId: randomUUID(), taskId: randomUUID(), purpose: "review", expectedTaskVersion: 1 };
const tuple = { workRevision: 2, artifactRef: "commit:synthetic", reworkRound: 0 };
it("accepts legacy producers and only complete explicit gate tuples", () => {
  expect(runRegister.safeParse(registration).success).toBe(true);
  expect(runRegister.safeParse({ ...registration, ...tuple }).success).toBe(true);
  expect(runRegister.safeParse({ ...registration, artifactRef: tuple.artifactRef }).success).toBe(false);
  expect(runRegister.safeParse({ ...registration, purpose: "implementation", ...tuple }).success).toBe(false);
  expect(evidence.artifactInput.safeParse({ expectedVersion: 1, artifactRef: "x".repeat(2001) }).success).toBe(false);
  expect(evidence.dependenciesInput.safeParse({ expectedVersion: 1, prerequisiteIds: Array.from({ length: 21 }, () => randomUUID()) }).success).toBe(false);
});
it("preserves legacy success while bounding explicit decision evidence", () => {
  const event = { schemaVersion: 1, eventId: randomUUID(), runId: randomUUID(), sequence: 1, occurredAt: "2026-10-11T00:00:00.000Z", type: "run.succeeded", payload: { summary: "done" } };
  expect(eventInput.safeParse(event).success).toBe(true);
  expect(eventInput.safeParse({ ...event, payload: { summary: "done", decision: "approved", evidenceNote: "reviewed" } }).success).toBe(true);
  expect(eventInput.safeParse({ ...event, payload: { summary: "done", decision: "approved" } }).success).toBe(false);
  expect(eventInput.safeParse({ ...event, payload: { summary: "done", surprise: true } }).success).toBe(false);
});
it("checks a whole diamond DAG without deriving grouping edges", () => {
  expect(() => validateDependencies([["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]])).not.toThrow();
  expect(() => validateDependencies([["a", "b"], ["b", "a"]])).toThrow("dependency_cycle");
  expect(deriveReadiness([])).toEqual({ ready: true, prerequisites: [], blockedPrerequisiteIds: [] });
  expect(deriveReadiness([{ taskId: "a", currentWorkRevision: 2, acceptedWorkRevision: 1, status: "completed" }])).toMatchObject({ ready: false, blockedPrerequisiteIds: ["a"] });
});
