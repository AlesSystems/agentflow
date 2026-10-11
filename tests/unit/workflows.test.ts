import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { validateWorkflowPlan, decideWorkflowEvent, workflowFreshness } from "../../src/domain/workflows";
import { workflowEventInput, planRevisionCreate } from "../../src/contracts/workflows";
const nodes = Array.from({ length: 100 }, () => ({ id: randomUUID(), label: "Synthetic node" }));
describe("immutable workflow DAG", () => {
  it("accepts a bounded branching plan", () => {
    expect(() => validateWorkflowPlan({ nodes, edges: [{ source: nodes[0].id, target: nodes[1].id }, { source: nodes[0].id, target: nodes[2].id }] })).not.toThrow();
  });
  it("rejects cycles, self edges, duplicate nodes, pairs and absent endpoints", () => {
    for (const plan of [
      { nodes: [nodes[0], nodes[0]], edges: [] },
      { nodes, edges: [{ source: nodes[0].id, target: nodes[0].id }] },
      { nodes, edges: [{ source: nodes[0].id, target: randomUUID() }] },
      { nodes, edges: [{ source: nodes[0].id, target: nodes[1].id }, { source: nodes[1].id, target: nodes[0].id }] },
      { nodes, edges: Array(2).fill({ source: nodes[0].id, target: nodes[1].id }) },
    ]) expect(() => validateWorkflowPlan(plan)).toThrow();
  });
  it("bounds nodes and edges and rejects unknown skill fields", () => {
    const base = { id: randomUUID(), expectedWorkflowVersion: 1, nodes, edges: [] };
    expect(planRevisionCreate.safeParse(base).success).toBe(true);
    expect(planRevisionCreate.safeParse({ ...base, nodes: [...nodes, { id: randomUUID(), label: "extra" }] }).success).toBe(false);
    expect(planRevisionCreate.safeParse({ ...base, edges: Array(201).fill({ source: nodes[0].id, target: nodes[1].id }) }).success).toBe(false);
    expect(workflowEventInput.safeParse({ schemaVersion: 1, eventId: randomUUID(), workflowRunId: randomUUID(), sequence: 1, occurredAt: "2026-10-11T00:00:00Z", type: "workflow.node.reported", payload: { nodeId: nodes[0].id, state: "running", reportedSkill: { name: "inert", execute: "no" } } }).success).toBe(false);
  });
});
const facts = { id: randomUUID(), workflowId: randomUUID(), planRevisionId: randomUUID(), projectId: randomUUID(), state: "queued" as const, version: 1, lastSequence: 0, createdAt: "2026-10-11T00:00:00.000Z", lastReceivedAt: "2026-10-11T00:00:00.000Z", startedAt: null, endedAt: null };
it("orders workflow transitions and measures silence independently", () => {
  const event = workflowEventInput.parse({ schemaVersion: 1, eventId: randomUUID(), workflowRunId: facts.id, sequence: 1, occurredAt: facts.createdAt, type: "workflow.started", payload: {} });
  const next = decideWorkflowEvent(facts, event, Date.parse(facts.createdAt));
  expect(next.state).toBe("running");
  expect(next.lastSequence).toBe(1);
  expect(workflowFreshness(next, Date.parse(facts.createdAt) + 60001).stale).toBe(true);
  expect(() => decideWorkflowEvent(facts, { ...event, sequence: 2 }, Date.now())).toThrow("sequence_gap");
});
