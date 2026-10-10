import { pageData } from "../../../server/page-data";
import { trackingBoardResponse as boardResponse } from "../../../contracts/tracking";
import { projectResponse } from "../../../contracts/responses";
import { boardQuery } from "../../../contracts/tasks";
import { Workspace } from "../../../client/provider";
import { Shell, NeedsPairing } from "../../../components/shell";
import { Board } from "../../../components/board/board";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const raw = await searchParams;
  const input = boardQuery.safeParse({ ...raw, limit: 50 });
  const filters = input.success ? input.data : { limit: 50 };
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) search.set(key, String(value));
  }
  search.sort();
  const data = await pageData(
    `/tracking/projects/${projectId}/board?${search}`,
    { kind: "tracking.board", id: projectId, input: filters },
    boardResponse,
    [
      {
        path: `/projects/${projectId}`,
        query: { kind: "project", id: projectId },
        schema: projectResponse,
      },
    ],
  );
  return data ? (
    <Workspace {...data}>
      <Shell>
        <Board
          projectId={projectId}
          initialFilters={search.size ? "?" + search.toString() : ""}
        />
      </Shell>
    </Workspace>
  ) : (
    <NeedsPairing />
  );
}
