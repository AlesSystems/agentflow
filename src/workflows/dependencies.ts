import { Conflict } from "../domain/tasks";
import type { TaskReadiness } from "../contracts/evidence";
export function validateDependencies(edges: readonly (readonly [string, string])[]) {
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const [task, prerequisite] of edges) {
    if (task === prerequisite) throw new Conflict("dependency_self");
    adjacency.set(task, [...(adjacency.get(task) ?? []), prerequisite]);
    indegree.set(task, indegree.get(task) ?? 0);
    indegree.set(prerequisite, (indegree.get(prerequisite) ?? 0) + 1);
  }
  const pending = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  for (let index = 0; index < pending.length; index++) {
    visited++;
    for (const id of adjacency.get(pending[index]) ?? []) {
      const degree = indegree.get(id)! - 1;
      indegree.set(id, degree);
      if (degree === 0) pending.push(id);
    }
  }
  if (visited !== indegree.size) throw new Conflict("dependency_cycle");
}
export function deriveReadiness(facts: { taskId: string; currentWorkRevision: number; acceptedWorkRevision: number | null; status: string }[]): TaskReadiness {
  const prerequisites = facts.map(fact => ({ ...fact, reason: fact.status !== "completed" ? "not_completed" as const : fact.acceptedWorkRevision !== fact.currentWorkRevision ? "acceptance_obsolete" as const : null }));
  const blockedPrerequisiteIds = prerequisites.filter(fact => fact.reason !== null).map(fact => fact.taskId);
  return { ready: blockedPrerequisiteIds.length === 0, prerequisites, blockedPrerequisiteIds };
}
