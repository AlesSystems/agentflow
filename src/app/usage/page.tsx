import { pageData } from "../../server/page-data";
import { projectsResponse } from "../../contracts/responses";
import { priceSnapshotsResponse } from "../../contracts/usage";
import { Workspace } from "../../client/provider";
import { Shell, NeedsPairing } from "../../components/shell";
import { Usage } from "../../components/usage";
export const dynamic = "force-dynamic";
export default async function Page() {
  const data = await pageData("/projects?limit=50", { kind: "projects", input: { limit: 50 } }, projectsResponse, [
    { path: "/usage/price-snapshots?limit=50", query: { kind: "usage.prices", input: { limit: 50 } }, schema: priceSnapshotsResponse },
  ]);
  return data ? <Workspace {...data}><Shell><Usage /></Shell></Workspace> : <NeedsPairing />;
}
