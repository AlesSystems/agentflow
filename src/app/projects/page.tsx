import { pageData } from "../../server/page-data";
import { projectsResponse } from "../../contracts/responses";
import { Workspace } from "../../client/provider";
import { Shell, NeedsPairing } from "../../components/shell";
import { Projects } from "../../components/projects";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { create } = await searchParams;
  const data = await pageData(
    "/projects?archived=false&limit=50",
    { kind: "projects", input: { limit: 50, archived: "false" } },
    projectsResponse,
  );
  return data ? (
    <Workspace {...data}>
      <Shell>
        <Projects initialCreate={create === "1"} />
      </Shell>
    </Workspace>
  ) : (
    <NeedsPairing />
  );
}
