import { pageData } from "../../../server/page-data";
import { trackingRunResponse } from "../../../contracts/tracking";
import { Workspace } from "../../../client/provider";
import { Shell, NeedsPairing } from "../../../components/shell";
import { RunDetail } from "../../../components/tracking";
import { WorkflowReturn } from "../../../components/workflows/return";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const { runId } = await params;
  const raw=await searchParams;
  const data = await pageData(`/tracking/runs/${runId}`, { kind: "tracking.run", id: runId }, trackingRunResponse);
  return data ? <Workspace {...data}><Shell><WorkflowReturn projectId={raw.projectId} value={raw.workflowReturn}/><RunDetail id={runId}/></Shell></Workspace> : <NeedsPairing />;
}
