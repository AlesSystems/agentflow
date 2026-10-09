import { boardQuery } from "../../../../../contracts/tasks";
import { pageData } from "../../../../../server/page-data";
import {
  taskDetailResponse,
  projectResponse,
} from "../../../../../contracts/responses";
import { Workspace } from "../../../../../client/provider";
import { Shell, NeedsPairing } from "../../../../../components/shell";
import { TaskPage } from "../../../../../components/tasks/page";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; taskId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId, taskId } = await params;
  const parsed = boardQuery.safeParse({ ...(await searchParams), limit: 50 });
  const filters = new URLSearchParams();
  if (parsed.success)
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined && key !== "limit")
        filters.set(key, String(value));
    }
  filters.sort();
  const data = await pageData(
    `/tasks/${taskId}`,
    { kind: "task", id: taskId, input: { history: "both", historyLimit: 50 } },
    taskDetailResponse,
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
        <TaskPage
          projectId={projectId}
          taskId={taskId}
          boardSearch={filters.size ? "?" + filters.toString() : ""}
        />
      </Shell>
    </Workspace>
  ) : (
    <NeedsPairing />
  );
}
