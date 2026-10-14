import "server-only";
import { codexId, codexListQuery, codexDetailQuery } from "../contracts/codex";
import { taskCreationPreference } from "../contracts/task-registration";
import { uuid } from "../contracts/common";
import { canonicalDigest } from "../domain/request-digest";
import { matchEndpoint, validResourceId } from "../contracts/routes";
import { privateContext, json, failure } from "./next-boundary";
import { HttpError, requireResourceMutation } from "./security";
export async function applicationApi(request: Request) {
  let generation: string | undefined;
  let currentGeneration:(()=>string)|undefined;
  try {
    const url = new URL(request.url);
    const matched = matchEndpoint(request.method, url.pathname);
    const state = privateContext(
      request.headers,
      matched?.endpoint.access ?? "read",
      (value) => (generation = value),
    );
    currentGeneration=()=>state.owned.store.metadata().generation;
    if (!matched) throw new HttpError(404, "resource_not_found");
    if (!Object.values(matched.params).every(value => matched.endpoint.kind === "observation" ? codexId.safeParse(value).success : validResourceId(value)))
      throw new HttpError(422, "validation_failed");
    const { endpoint, id, path } = matched;
    if (endpoint.kind === "stream" || endpoint.kind === "export") throw new HttpError(503, "unavailable");
    let original: unknown;
    if (endpoint.kind === "command") {
      if (url.searchParams.size) throw new HttpError(400, "query_invalid");
      requireResourceMutation(request.headers, state.principal);
      if (
        !endpoint.eventIdentity &&
        !uuid.safeParse(request.headers.get("idempotency-key")).success
      )
        throw new HttpError(422, "idempotency_key_invalid");
      try {
        original = await request.json();
      } catch {
        throw new HttpError(400, "json_invalid");
      }
    } else {
      const params: Record<string, string> = {};
      for (const [key, value] of url.searchParams) {
        if (key in params) throw new HttpError(400, "query_invalid");
        params[key] = value;
      }
      original = params;
    }
    if (endpoint.kind === "observation") {
      if (!state.codex) throw new HttpError(503, "unavailable");
      const input = endpoint.input.safeParse(original);
      if (!input.success) throw new HttpError(400, "query_invalid");
      const body = endpoint.observation === "codex.list"
        ? await state.codex.list(codexListQuery.parse(input.data))
        : await state.codex.detail(id!, codexDetailQuery.parse(input.data));
      return json(endpoint.response.parse(body), 200, { "AgentFlow-Generation": currentGeneration() });
    }
    if (
      endpoint.eventIdentity &&
      typeof original === "object" &&
      original !== null &&
      "schemaVersion" in original &&
      original.schemaVersion !== 1
    )
      throw new HttpError(422, "unsupported_schema_version");
    const parsed = endpoint.parseRequest(original, id ?? "", matched.params);
    if (!parsed.success)
      throw new HttpError(
        endpoint.kind === "command" ? 422 : 400,
        endpoint.kind === "command" ? "validation_failed" : "query_invalid",
      );
    if (
      parsed.success &&
      parsed.action.kind === "command" &&
      parsed.action.command.kind === "run.event" &&
      parsed.action.command.input.runId !== id
    )
      throw new HttpError(422, "validation_failed");
    if (parsed.action.kind === "command" && parsed.action.command.kind === "workflow.run.event" && parsed.action.command.input.workflowRunId !== id) throw new HttpError(422, "validation_failed");
    const context={principal:state.principal.id,method:request.method,path,key:request.headers.get("idempotency-key")?.toLowerCase() ?? "",digest:canonicalDigest(original),now:Date.now()};
    const action=parsed.action;
    const reply = action.kind === "command"
      ? action.command.kind === "retention.prune" ? await state.history.prune(action.command.input,context,request.signal)
        : action.command.kind === "retention.preview" ? state.owned.store.historyPreview(action.command.input,context)
        : action.command.kind === "github.refresh" ? await state.github.refresh(action.command.input,context)
        : action.command.kind === "github.repositories" ? state.github.repositories(action.command.input,context)
        : state.owned.store.command(action.command,context)
      : action.query.kind === "github" ? state.github.snapshot(action.query.input) : state.owned.store.snapshot(action.query,Date.now());
    const taskReply = endpoint.taskCreationReply;
    const minimal = taskReply && taskCreationPreference(request.headers.get("Prefer"));
    const response = json(minimal ? taskReply.project(reply.body) : reply.body, reply.status, {
      "AgentFlow-Generation": currentGeneration(),
      ...(minimal ? { "Preference-Applied": "return=minimal" } : {}),
    });
    if (taskReply) response.headers.append("Vary", "Prefer");
    return response;
  } catch (error) {
    return failure(error, currentGeneration?.() ?? generation);
  }
}
