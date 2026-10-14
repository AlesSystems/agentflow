"use client";
// Dropdown patterns adapted from shadcn/ui, MIT, copyright shadcn.
import Link from "next/link";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { useRead } from "../client/provider";
import { projectResponse, projectsResponse } from "../contracts/responses";
const workspace = [
  ["/projects", "All projects"],
  ["/agents", "Agents"],
  ["/activity", "Activity"],
  ["/usage", "Usage"],
  ["/codex", "Codex chats"],
  ["/claude", "Claude sessions"],
] as const;
export function ProjectSwitcher({ projectId }: { projectId?: string }) {
  const projects = useRead("/projects?archived=false&limit=50", projectsResponse);
  return (
    <Menu.Root>
      <Menu.Trigger className="project-switch">
        <span>{projectId ? <ProjectName id={projectId} /> : "Projects"}</span>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 5.5l4 3.8 4-3.8" />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" sideOffset={6} align="start">
          <Menu.Label className="menu-label">Projects</Menu.Label>
          {projects.data?.data.items.map((project) => (
            <Menu.Item key={project.id} asChild>
              <Link href={`/projects/${project.id}`} aria-current={project.id === projectId ? "page" : undefined}>
                {project.name}
              </Link>
            </Menu.Item>
          ))}
          {projects.data && !projects.data.data.items.length && (
            <Menu.Item disabled>No active projects</Menu.Item>
          )}
          <Menu.Item asChild>
            <Link href="/projects?create=1">New project</Link>
          </Menu.Item>
          <Menu.Separator className="menu-separator" />
          <Menu.Label className="menu-label">Workspace</Menu.Label>
          {workspace.map(([href, label]) => (
            <Menu.Item key={href} asChild>
              <Link href={href}>{label}</Link>
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
function ProjectName({ id }: { id: string }) {
  const project = useRead(`/projects/${id}`, projectResponse);
  return <>{project.data?.data.name ?? "Project"}</>;
}
