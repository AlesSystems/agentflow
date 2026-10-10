import { pageData } from "../../../server/page-data";
import { trackingRunResponse } from "../../../contracts/tracking";
import { Workspace } from "../../../client/provider";
import { Shell, NeedsPairing } from "../../../components/shell";
import { RunDetail } from "../../../components/tracking";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const data = await pageData(`/tracking/runs/${runId}`, { kind: "tracking.run", id: runId }, trackingRunResponse);
  return data ? <Workspace {...data}><Shell><RunDetail id={runId}/></Shell></Workspace> : <NeedsPairing />;
}
