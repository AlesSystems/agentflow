import type { WorkflowPlan } from "../../contracts/workflows";
export function graphLayout(plan: WorkflowPlan) {
  const levels = new Map(plan.nodes.map((n) => [n.id, 0])),
    incoming = new Map(plan.nodes.map((n) => [n.id, 0])),
    children = new Map(plan.nodes.map((n) => [n.id, [] as string[]]));
  for (const e of plan.edges) {
    incoming.set(e.target, incoming.get(e.target)! + 1);
    children.get(e.source)!.push(e.target);
  }
  const queue = plan.nodes
    .filter((n) => incoming.get(n.id) === 0)
    .map((n) => n.id);
  for (let i = 0; i < queue.length; i++)
    for (const target of children.get(queue[i])!) {
      levels.set(
        target,
        Math.max(levels.get(target)!, levels.get(queue[i])! + 1),
      );
      incoming.set(target, incoming.get(target)! - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  const rows = new Map<number, number>();
  return plan.nodes.map((n) => {
    const layer = levels.get(n.id)!,
      row = rows.get(layer) ?? 0;
    rows.set(layer, row + 1);
    return { id: n.id, position: { x: layer * 280, y: row * 130 } };
  });
}
