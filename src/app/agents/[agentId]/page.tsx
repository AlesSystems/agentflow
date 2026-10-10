import { pageData } from "../../../server/page-data";
import { agentResponse } from "../../../contracts/observations";
import { Workspace } from "../../../client/provider";
import { Shell, NeedsPairing } from "../../../components/shell";
import { AgentDetail } from "../../../components/tracking";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const data = await pageData(`/agents/${agentId}`, { kind: "agent", id: agentId }, agentResponse);
  return data ? <Workspace {...data}><Shell><AgentDetail id={agentId}/></Shell></Workspace> : <NeedsPairing />;
}
