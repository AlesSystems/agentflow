import { z } from "zod";
import { pageQuery, uuid } from "./common";
import { projectCreate, projectPatch, projectQuery } from "./projects";
import {
  taskCreate,
  taskPatch,
  taskQuery,
  taskDetailQueryV1,
  boardQuery,
  commentInput,
  completeInput,
  reopenInput,
} from "./tasks";
import { settingsPatch } from "./settings";
import { overviewQuery } from "./overview";
import type { ApplicationCommand, ApplicationQuery } from "../db/application";
import { projectsResponse, projectResponse, boardResponse, tasksResponse, taskResponse, taskDetailResponse, completionResponse, commentsResponse, commentResponse, settingsResponse, overviewResponse } from "./responses";
export const emptyQuery = z.strictObject({});
const commentsQuery = z.strictObject(pageQuery);
type EndpointBase = {
  id: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  access: "read" | "report" | "human";
  input: z.ZodType;
  response: z.ZodType;
  status: number;
};
export type EndpointAction =
  | { kind: "command"; command: ApplicationCommand }
  | { kind: "query"; query: ApplicationQuery };
export type Endpoint = EndpointBase & {
  kind: "command" | "query";
  parseRequest: (
    original: unknown,
    id: string,
  ) => { success: true; action: EndpointAction } | { success: false };
};
function defineCommand<S extends z.ZodType>(
  definition: EndpointBase & {
    input: S;
    command: (input: z.output<S>, id: string) => ApplicationCommand;
  },
): Endpoint {
  const { command, ...base } = definition;
  return {
    ...base,
    kind: "command",
    parseRequest: (original, id) => {
      const parsed = definition.input.safeParse(original);
      return parsed.success
        ? {
            success: true,
            action: { kind: "command", command: command(parsed.data, id) },
          }
        : { success: false };
    },
  };
}
function defineQuery<S extends z.ZodType>(
  definition: EndpointBase & {
    input: S;
    query: (input: z.output<S>, id: string) => ApplicationQuery;
  },
): Endpoint {
  const { query, ...base } = definition;
  return {
    ...base,
    kind: "query",
    parseRequest: (original, id) => {
      const parsed = definition.input.safeParse(original);
      return parsed.success
        ? {
            success: true,
            action: { kind: "query", query: query(parsed.data, id) },
          }
        : { success: false };
    },
  };
}
export const endpoints: Endpoint[] = [
  defineQuery({
    id: "listProjects",
    method: "GET",
    path: "/projects",
    access: "read",
    input: projectQuery,
    response: projectsResponse,
    status: 200,
    query: (input) => ({ kind: "projects", input }),
  }),
  defineCommand({
    id: "createProject",
    method: "POST",
    path: "/projects",
    access: "report",
    input: projectCreate,
    response: projectResponse,
    status: 201,
    command: (input) => ({ kind: "project.create", input }),
  }),
  defineQuery({
    id: "getProject",
    method: "GET",
    path: "/projects/{id}",
    access: "read",
    input: emptyQuery,
    response: projectResponse,
    status: 200,
    query: (_, id) => ({ kind: "project", id }),
  }),
  defineCommand({
    id: "patchProject",
    method: "PATCH",
    path: "/projects/{id}",
    access: "report",
    input: projectPatch,
    response: projectResponse,
    status: 200,
    command: (input, id) => ({ kind: "project.patch", id, input }),
  }),
  defineQuery({
    id: "getBoard",
    method: "GET",
    path: "/projects/{id}/board",
    access: "read",
    input: boardQuery,
    response: boardResponse,
    status: 200,
    query: (input, id) => ({ kind: "board", id, input }),
  }),
  defineQuery({
    id: "listTasks",
    method: "GET",
    path: "/tasks",
    access: "read",
    input: taskQuery,
    response: tasksResponse,
    status: 200,
    query: (input) => ({ kind: "tasks", input }),
  }),
  defineCommand({
    id: "createTask",
    method: "POST",
    path: "/tasks",
    access: "report",
    input: taskCreate,
    response: taskResponse,
    status: 201,
    command: (input) => ({ kind: "task.create", input }),
  }),
  defineQuery({
    id: "getTask",
    method: "GET",
    path: "/tasks/{id}",
    access: "read",
    input: taskDetailQueryV1,
    response: taskDetailResponse,
    status: 200,
    query: (input, id) => ({ kind: "task", id, input }),
  }),
  defineCommand({
    id: "patchTask",
    method: "PATCH",
    path: "/tasks/{id}",
    access: "report",
    input: taskPatch,
    response: taskResponse,
    status: 200,
    command: (input, id) => ({ kind: "task.patch", id, input }),
  }),
  defineCommand({
    id: "completeTask",
    method: "POST",
    path: "/tasks/{id}/complete",
    access: "human",
    input: completeInput,
    response: completionResponse,
    status: 201,
    command: (input, id) => ({ kind: "task.complete", id, input }),
  }),
  defineCommand({
    id: "reopenTask",
    method: "POST",
    path: "/tasks/{id}/reopen",
    access: "human",
    input: reopenInput,
    response: taskResponse,
    status: 200,
    command: (input, id) => ({ kind: "task.reopen", id, input }),
  }),
  defineQuery({
    id: "listComments",
    method: "GET",
    path: "/tasks/{id}/comments",
    access: "read",
    input: commentsQuery,
    response: commentsResponse,
    status: 200,
    query: (input, id) => ({ kind: "comments", id, input }),
  }),
  defineCommand({
    id: "createComment",
    method: "POST",
    path: "/tasks/{id}/comments",
    access: "report",
    input: commentInput,
    response: commentResponse,
    status: 201,
    command: (input, id) => ({ kind: "comment.create", id, input }),
  }),
  defineQuery({
    id: "getSettings",
    method: "GET",
    path: "/settings",
    access: "read",
    input: emptyQuery,
    response: settingsResponse,
    status: 200,
    query: () => ({ kind: "settings" }),
  }),
  defineCommand({
    id: "patchSettings",
    method: "PATCH",
    path: "/settings",
    access: "human",
    input: settingsPatch,
    response: settingsResponse,
    status: 200,
    command: (input) => ({ kind: "settings.patch", input }),
  }),
  defineQuery({
    id: "getOverview",
    method: "GET",
    path: "/overview",
    access: "read",
    input: overviewQuery,
    response: overviewResponse,
    status: 200,
    query: (input) => ({ kind: "overview", input }),
  }),
];
export function matchEndpoint(method: string, pathname: string) {
  for (const endpoint of endpoints) {
    if (endpoint.method !== (method === "HEAD" ? "GET" : method)) continue;
    const match = new RegExp(
      "^/api/v1" + endpoint.path.replace("{id}", "([^/]+)") + "/?$",
    ).exec(pathname);
    if (match) {
      const id = match[1];
      return {
        endpoint,
        id: id?.toLowerCase(),
        path:
          "/api/v1" + endpoint.path.replace("{id}", id?.toLowerCase() ?? ""),
      };
    }
  }
  return null;
}
export function validResourceId(id: string | undefined) {
  return id === undefined || uuid.safeParse(id).success;
}
