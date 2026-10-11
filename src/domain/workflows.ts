import { workflowPlan, type WorkflowPlan, type WorkflowRunFacts, type WorkflowEventInput } from "../contracts/workflows";
import { Conflict } from "./tasks";
export function validateWorkflowPlan(plan: WorkflowPlan): void {
  if (!workflowPlan.safeParse(plan).success) throw new Conflict("workflow_plan_invalid");
  const incoming = new Map(plan.nodes.map(node => [node.id, 0]));
  if (incoming.size !== plan.nodes.length) throw new Conflict("workflow_node_duplicate");
  const children = new Map(plan.nodes.map(node => [node.id, [] as string[]]));
  const pairs = new Set<string>();
  for (const edge of plan.edges) {
    if (!incoming.has(edge.source) || !incoming.has(edge.target)) throw new Conflict("workflow_endpoint_missing");
    if (edge.source === edge.target) throw new Conflict("workflow_self_edge");
    const pair = edge.source + ":" + edge.target;
    if (pairs.has(pair)) throw new Conflict("workflow_edge_duplicate");
    pairs.add(pair);
    children.get(edge.source)!.push(edge.target);
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
  }
  const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  for (let i = 0; i < ready.length; i++) {
    visited++;
    for (const child of children.get(ready[i])!) {
      incoming.set(child, incoming.get(child)! - 1);
      if (incoming.get(child) === 0) ready.push(child);
    }
  }
  if (visited !== plan.nodes.length) throw new Conflict("workflow_cycle");
}
export function workflowFreshness(run: WorkflowRunFacts, now: number) {
  const active = run.state === "queued" || run.state === "running";
  const stale = active && now - Date.parse(run.lastReceivedAt) > 60000;
  return { stale, reporting: !active ? "terminal" as const : stale ? "stale" as const : run.lastSequence === 0 ? "no_report_received" as const : "fresh" as const };
}
export type WorkflowDecision = WorkflowRunFacts;
export function decideWorkflowEvent(run: WorkflowRunFacts, event: WorkflowEventInput, now: number): WorkflowDecision {
  if (event.sequence !== run.lastSequence + 1) throw new Conflict(event.sequence > run.lastSequence + 1 ? "sequence_gap" : "sequence_conflict", undefined, { expectedSequence: run.lastSequence + 1 });
  if (run.state !== "queued" && run.state !== "running") throw new Conflict("run_terminal");
  if ((run.state === "queued" && event.type !== "workflow.started" && event.type !== "workflow.cancelled") || (run.state === "running" && event.type === "workflow.started")) throw new Conflict("run_transition_invalid");
  const outcomes = { "workflow.started": "running", "workflow.succeeded": "succeeded", "workflow.failed": "failed", "workflow.cancelled": "cancelled" } as const;
  const state = event.type in outcomes ? outcomes[event.type as keyof typeof outcomes] : run.state;
  const time = new Date(now).toISOString();
  return { ...run, state, version: run.version + 1, lastSequence: event.sequence, lastReceivedAt: time, startedAt: event.type === "workflow.started" ? time : run.startedAt, endedAt: ["succeeded", "failed", "cancelled"].includes(state) ? time : run.endedAt };
}
