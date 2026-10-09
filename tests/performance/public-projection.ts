import type { ApplicationQuery, SnapshotBody } from "../../src/db/application";
import { taskDetailV1 } from "../../src/contracts/tasks";
export function comparableSnapshot(
  query: ApplicationQuery,
  body: SnapshotBody,
): unknown {
  if (query.kind !== "task") return body.data;
  const data = body.data as { latestRun: Record<string, unknown> | null };
  let latestRun = data.latestRun;
  if (latestRun) {
    const { registrationOrder, ...publicRun } = latestRun;
    void registrationOrder;
    latestRun = publicRun;
  }
  return taskDetailV1.parse({ ...data, latestRun });
}
