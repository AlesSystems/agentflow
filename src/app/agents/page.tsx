import { pageData } from "../../server/page-data";
import { trackingAgentsResponse } from "../../contracts/tracking";
import { Workspace } from "../../client/provider";
import { Shell, NeedsPairing } from "../../components/shell";
import { Agents } from "../../components/tracking";
export const dynamic = "force-dynamic";
export default async function Page() {
  const data = await pageData("/tracking/agents?limit=50", { kind: "tracking.agents", input: { limit: 50 } }, trackingAgentsResponse);
  return data ? <Workspace {...data}><Shell><Agents /></Shell></Workspace> : <NeedsPairing />;
}
