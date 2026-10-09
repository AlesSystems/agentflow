import "server-only";
import { uuid } from "../contracts/common";
import { canonicalDigest } from "../domain/request-digest";
import { matchEndpoint, validResourceId } from "../contracts/routes";
import { privateContext, json, failure } from "./next-boundary";
import { HttpError, requireResourceMutation } from "./security";
export async function applicationApi(request: Request) {
  let generation: string | undefined;
  try {
    const url = new URL(request.url);
    const matched = matchEndpoint(request.method, url.pathname);
    const state = privateContext(
      request.headers,
      matched?.endpoint.access ?? "read",
      (value) => (generation = value),
    );
    if (!matched) throw new HttpError(404, "resource_not_found");
    if (!validResourceId(matched.id))
      throw new HttpError(422, "validation_failed");
    const { endpoint, id, path } = matched;
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
    if (
      endpoint.eventIdentity &&
      typeof original === "object" &&
      original !== null &&
      "schemaVersion" in original &&
      original.schemaVersion !== 1
    )
      throw new HttpError(422, "unsupported_schema_version");
    const parsed = endpoint.parseRequest(original, id ?? "");
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
    const reply =
      parsed.action.kind === "command"
        ? state.owned.store.command(parsed.action.command, {
            principal: state.principal.id,
            method: request.method,
            path,
            key: request.headers.get("idempotency-key")?.toLowerCase() ?? "",
            digest: canonicalDigest(original),
            now: Date.now(),
          })
        : state.owned.store.snapshot(parsed.action.query, Date.now());
    return json(reply.body, reply.status, {
      "AgentFlow-Generation": generation!,
    });
  } catch (error) {
    return failure(error, generation);
  }
}
