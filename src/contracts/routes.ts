import { taskRegistrationResponse, projectTaskRegistration } from "./task-registration";
import type { SnapshotBody } from "../db/application";
import { z } from "zod";
import { streamQuery, changeNotice } from "./stream";
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
import {
  projectsResponse,
  projectResponse,
  boardResponse,
  tasksResponse,
  taskResponse,
  taskDetailResponse,
  completionResponse,
  commentsResponse,
  commentResponse,
  settingsResponse,
  overviewResponse,
} from "./responses";
import * as workflows from "./workflows";
import * as observations from "./observations";
import * as tracking from "./tracking";
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
  eventIdentity?: boolean;
  taskCreationReply?: { response: z.ZodType; project: (body: SnapshotBody) => SnapshotBody };
  description?: string;
};
export type EndpointAction =
  | { kind: "command"; command: ApplicationCommand }
  | { kind: "query"; query: ApplicationQuery };
type ResourceEndpoint = EndpointBase & {
  kind: "command" | "query";
  parseRequest: (
    original: unknown,
    id: string,
    params?: Record<string, string>,
  ) => { success: true; action: EndpointAction } | { success: false };
};
export type StreamEndpoint = EndpointBase & { kind: "stream" };
export type Endpoint = ResourceEndpoint | StreamEndpoint;
function defineCommand<S extends z.ZodType>(
  definition: EndpointBase & {
    input: S;
    command: (input: z.output<S>, id: string) => ApplicationCommand;
  },
): ResourceEndpoint {
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
    query: (input: z.output<S>, id: string, params: Record<string, string>) => ApplicationQuery;
  },
): ResourceEndpoint {
  const { query, ...base } = definition;
  return {
    ...base,
    kind: "query",
    parseRequest: (original, id, params = {}) => {
      const parsed = definition.input.safeParse(original);
      return parsed.success
        ? {
            success: true,
            action: { kind: "query", query: query(parsed.data, id, params) },
          }
        : { success: false };
    },
  };
}
export const endpoints: Endpoint[] = [
  defineQuery({ id: "getWorkflowRunSnapshot", method: "GET", path: "/workflow-runs/{id}/snapshot", access: "read", input: emptyQuery, response: workflows.workflowRunDetailResponse, status: 200, query: (_, id) => ({ kind: "workflow.run", id }) }),
  defineCommand({ id: "registerWorkflowRun", method: "POST", path: "/workflow-runs", access: "report", input: workflows.workflowRunRegister, response: workflows.workflowRunResponse, status: 201, command: input => ({ kind: "workflow.run.register", input }) }),
  defineQuery({ id: "listWorkflowRuns", method: "GET", path: "/workflow-runs", access: "read", input: workflows.workflowRunQuery, response: workflows.workflowRunsResponse, status: 200, query: input => ({ kind: "workflow.runs", input }) }),
  defineQuery({ id: "getWorkflowRun", method: "GET", path: "/workflow-runs/{id}", access: "read", input: emptyQuery, response: workflows.workflowRunResponse, status: 200, query: (_, id) => ({ kind: "workflow.run.summary", id }) }),
  defineCommand({ id: "ingestWorkflowEvent", method: "POST", path: "/workflow-runs/{id}/events", access: "report", input: workflows.workflowEventInput, response: workflows.workflowEventResponse, status: 201, eventIdentity: true, command: (input, id) => ({ kind: "workflow.run.event", id, input }) }),
  defineQuery({ id: "listWorkflowEvents", method: "GET", path: "/workflow-runs/{id}/events", access: "read", input: workflows.workflowHistoryQuery, response: workflows.workflowEventsResponse, status: 200, query: (input, id) => ({ kind: "workflow.events", id, input }) }),
  defineQuery({ id: "listWorkflowNodeObservations", method: "GET", path: "/workflow-runs/{id}/nodes/{nodeId}/observations", access: "read", input: workflows.workflowHistoryQuery, response: workflows.workflowNodeHistoryResponse, status: 200, query: (input, id, params) => ({ kind: "workflow.nodes", id, nodeId: params.nodeId, input }) }),
  defineCommand({ id: "closeWorkflowRun", method: "POST", path: "/workflow-runs/{id}/close", access: "human", input: workflows.workflowClose, response: workflows.workflowRunResponse, status: 200, command: (input, id) => ({ kind: "workflow.run.close", id, input }) }),
  defineCommand({ id: "createWorkflow", method: "POST", path: "/workflows", access: "report", input: workflows.workflowCreate, response: workflows.workflowResponse, status: 201, command: input => ({ kind: "workflow.create", input }) }),
  defineQuery({ id: "listWorkflows", method: "GET", path: "/workflows", access: "read", input: workflows.workflowQuery, response: workflows.workflowsResponse, status: 200, query: input => ({ kind: "workflows", input }) }),
  defineQuery({ id: "getWorkflow", method: "GET", path: "/workflows/{id}", access: "read", input: emptyQuery, response: workflows.workflowResponse, status: 200, query: (_, id) => ({ kind: "workflow", id }) }),
  defineCommand({ id: "createWorkflowRevision", method: "POST", path: "/workflows/{id}/revisions", access: "report", input: workflows.planRevisionCreate, response: workflows.revisionAcknowledgementResponse, status: 201, command: (input, id) => ({ kind: "workflow.revision", id, input }) }),
  defineQuery({ id: "listWorkflowRevisions", method: "GET", path: "/workflows/{id}/revisions", access: "read", input: workflows.workflowHistoryQuery, response: workflows.revisionsResponse, status: 200, query: (input, id) => ({ kind: "workflow.revisions", id, input }) }),
  defineQuery({ id: "getWorkflowRevision", method: "GET", path: "/workflows/{id}/revisions/{revisionId}", access: "read", input: emptyQuery, response: workflows.revisionResponse, status: 200, query: (_, id, params) => ({ kind: "workflow.revision", id, revisionId: params.revisionId }) }),
  { id: "changeStream", method: "GET", path: "/changes/stream", access: "human", input: streamQuery, response: changeNotice, status: 200, kind: "stream", description: "Browser-cookie invalidations; Last-Event-ID overrides a valid after. Canonical signed SQLite cursor range. Finite HEAD. 20 streams; 1 MiB buffer cap and 5 second stalled-drain close." },
  defineQuery({ id: "trackingAgents", method: "GET", path: "/tracking/agents", access: "read", input: observations.agentQuery, response: tracking.trackingAgentsResponse, status: 200, query: (input) => ({ kind: "tracking.agents", input }) }),
  defineQuery({ id: "trackingRuns", method: "GET", path: "/tracking/runs", access: "read", input: observations.runQuery, response: tracking.trackingRunsResponse, status: 200, query: (input) => ({ kind: "tracking.runs", input }) }),
  defineQuery({ id: "trackingRun", method: "GET", path: "/tracking/runs/{id}", access: "read", input: emptyQuery, response: tracking.trackingRunResponse, status: 200, query: (_, id) => ({ kind: "tracking.run", id }) }),
  defineQuery({ id: "trackingTasks", method: "GET", path: "/tracking/tasks", access: "read", input: taskQuery, response: tracking.trackingTasksResponse, status: 200, query: (input) => ({ kind: "tracking.tasks", input }) }),
  defineQuery({ id: "trackingBoard", method: "GET", path: "/tracking/projects/{id}/board", access: "read", input: boardQuery, response: tracking.trackingBoardResponse, status: 200, query: (input, id) => ({ kind: "tracking.board", input, id }) }),
  defineQuery({ id: "activity", method: "GET", path: "/activity", access: "read", input: tracking.activityQuery, response: tracking.activityResponse, status: 200, query: (input) => ({ kind: "activity", input }) }),
  defineQuery({
    id: "listAgents",
    method: "GET",
    path: "/agents",
    access: "read",
    input: observations.agentQuery,
    response: observations.agentsResponse,
    status: 200,
    query: (input) => ({ kind: "agents", input }),
  }),
  defineCommand({
    id: "createAgent",
    method: "POST",
    path: "/agents",
    access: "report",
    input: observations.agentCreate,
    response: observations.agentResponse,
    status: 201,
    command: (input) => ({ kind: "agent.create", input }),
  }),
  defineQuery({
    id: "getAgent",
    method: "GET",
    path: "/agents/{id}",
    access: "read",
    input: emptyQuery,
    response: observations.agentResponse,
    status: 200,
    query: (_, id) => ({ kind: "agent", id }),
  }),
  defineCommand({
    id: "patchAgent",
    method: "PATCH",
    path: "/agents/{id}",
    access: "report",
    input: observations.agentPatch,
    response: observations.agentResponse,
    status: 200,
    command: (input, id) => ({ kind: "agent.patch", id, input }),
  }),
  defineQuery({
    id: "listRuns",
    method: "GET",
    path: "/runs",
    access: "read",
    input: observations.runQuery,
    response: observations.runsResponse,
    status: 200,
    query: (input) => ({ kind: "runs", input }),
  }),
  defineCommand({
    id: "registerRun",
    method: "POST",
    path: "/runs",
    access: "report",
    input: observations.runRegister,
    response: observations.runResponse,
    status: 201,
    description:
      "Legacy run IDs have unavailable original registration identity and always return 409 run_conflict. New identical IDs replay original registration with 200; resource receipt replays retain their stored status.",
    command: (input) => ({ kind: "run.register", input }),
  }),
  defineQuery({
    id: "getRun",
    method: "GET",
    path: "/runs/{id}",
    access: "read",
    input: emptyQuery,
    response: observations.runResponse,
    status: 200,
    query: (_, id) => ({ kind: "run", id }),
  }),
  defineQuery({
    id: "listEvents",
    method: "GET",
    path: "/runs/{id}/events",
    access: "read",
    input: observations.eventQuery,
    response: observations.eventsResponse,
    status: 200,
    query: (input, id) => ({ kind: "events", id, input }),
  }),
  defineCommand({
    id: "ingestEvent",
    method: "POST",
    path: "/runs/{id}/events",
    access: "report",
    input: observations.eventInput,
    response: observations.eventResponse,
    status: 201,
    eventIdentity: true,
    command: (input, id) => ({ kind: "run.event", id, input }),
  }),
  defineCommand({
    id: "closeRun",
    method: "POST",
    path: "/runs/{id}/close",
    access: "human",
    input: observations.closeInput,
    response: observations.runResponse,
    status: 200,
    description:
      "Close stale active tracking only. The external process may still run; this sends no process signal.",
    command: (input, id) => ({ kind: "run.close", id, input }),
  }),
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
    taskCreationReply: { response: taskRegistrationResponse, project: projectTaskRegistration },
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
    const names: string[] = [];
    const pattern = endpoint.path.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, name: string) => { names.push(name); return "([^/]+)"; });
    const match = new RegExp("^/api/v1" + pattern + "/?$").exec(pathname);
    if (match) {
      const params = Object.fromEntries(names.map((name, i) => [name, match[i + 1].toLowerCase()]));
      return { endpoint, id: params.id, params, path: "/api/v1" + endpoint.path.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, name: string) => params[name]) };
    }
  }
  return null;
}
export function validResourceId(id: string | undefined) {
  return id === undefined || uuid.safeParse(id).success;
}
