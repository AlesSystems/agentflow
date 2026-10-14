import { pageData } from "../../../../server/page-data";
import { workflowsResponse } from "../../../../contracts/workflows";
import { Workspace } from "../../../../client/provider";
import { Shell, NeedsPairing } from "../../../../components/shell";
import { Workflows } from "../../../../components/workflows/workflows";
import { inputUuid } from "../../../../contracts/common";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId: rawProjectId } = await params,
    raw = await searchParams,
    selection: Record<string, string> = {};
  const project = inputUuid.safeParse(rawProjectId);
  const projectId = project.success ? project.data : rawProjectId;
  for (const key of ["workflowId", "revisionId", "workflowRunId", "nodeId"]) {
    const parsed = inputUuid.safeParse(raw[key]);
    if (parsed.success) selection[key] = parsed.data;
  }
  if (raw.view === "list" || raw.view === "graph") selection.view = raw.view;
  if (raw.focus === "node") selection.focus = "node";
  const data = await pageData(
    `/workflows?projectId=${projectId}&limit=20`,
    { kind: "workflows", input: { projectId, limit: 20 } },
    workflowsResponse,
  );
  return data ? (
    <Workspace {...data}>
      <Shell projectId={projectId}>
        <Workflows projectId={projectId} initial={selection} />
      </Shell>
    </Workspace>
  ) : (
    <NeedsPairing />
  );
}
