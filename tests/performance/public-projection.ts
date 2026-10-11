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
  const legacy=taskDetailV1.omit({readiness:true,evidence:true});
  const candidate={...data,latestRun};
  if("readiness" in candidate || "evidence" in candidate){const {readiness,evidence,...shared}=taskDetailV1.parse(candidate);void readiness;void evidence;return legacy.parse(shared);}
  return legacy.parse(candidate);
}
