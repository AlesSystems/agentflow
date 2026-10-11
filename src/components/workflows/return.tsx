import Link from "next/link";
import { inputUuid } from "../../contracts/common";
export function WorkflowReturn({
  projectId,
  value,
}: {
  projectId: unknown;
  value: unknown;
}) {
  const project = inputUuid.safeParse(projectId);
  if (!project.success || typeof value !== "string" || value.length > 1000)
    return null;
  const raw = new URLSearchParams(value),
    search = new URLSearchParams();
  for (const key of ["workflowId", "revisionId", "nodeId"]) {
    const id = inputUuid.safeParse(raw.get(key));
    if (!id.success) return null;
    search.set(key, id.data);
  }
  if (raw.has("workflowRunId")) {
    const attempt = inputUuid.safeParse(raw.get("workflowRunId"));
    if (!attempt.success) return null;
    search.set("workflowRunId", attempt.data);
  }
  const view = raw.get("view");
  if (view === "list" || view === "graph") search.set("view", view);
  search.set("focus", "node");
  return (
    <p>
      <Link href={`/projects/${project.data}/workflows?${search}`}>
        Back to workflow
      </Link>
    </p>
  );
}
