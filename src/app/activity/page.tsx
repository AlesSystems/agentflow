import { pageData } from "../../server/page-data";
import { activityResponse, activityQuery } from "../../contracts/tracking";
import { Workspace } from "../../client/provider";
import { Shell, NeedsPairing } from "../../components/shell";
import { Activity } from "../../components/tracking";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parsed = activityQuery.safeParse({ ...(await searchParams), limit: 30 });
  const input = parsed.success ? parsed.data : { limit: 30 };
  const filters = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (key !== "limit" && value !== undefined) filters.set(key, String(value));
  filters.sort();
  const data = await pageData(`/activity?limit=30${filters.size ? "&" + filters : ""}`, { kind: "activity", input }, activityResponse);
  return data ? <Workspace {...data}><Shell><Activity initialFilters={filters.toString()}/></Shell></Workspace> : <NeedsPairing />;
}
