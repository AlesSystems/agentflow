import { redirect } from "next/navigation";
import { pageData, firstActiveProjectId } from "../server/page-data";
import { projectsResponse } from "../contracts/responses";
import { Workspace } from "../client/provider";
import { Shell, NeedsPairing } from "../components/shell";
import { Projects } from "../components/projects";
export const dynamic = "force-dynamic";
export default async function Home() {
  const projectId = await firstActiveProjectId();
  if (projectId) redirect(`/projects/${projectId}`);
  const data = await pageData(
    "/projects?archived=false&limit=50",
    { kind: "projects", input: { limit: 50, archived: "false" } },
    projectsResponse,
  );
  if (!data) return <NeedsPairing />;
  return (
    <Workspace {...data}>
      <Shell>
        <Projects />
      </Shell>
    </Workspace>
  );
}
