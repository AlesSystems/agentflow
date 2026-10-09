import { isConflict } from "../domain/tasks";
import type { IncomingMessage } from "node:http";
import { cookieSecret, equalSecret, hashSecret } from "./auth";
import type { Credentials } from "./auth";
import type { Store } from "../db";
export type Principal =
  | { kind: "browser"; id: "operator"; sessionId: string }
  | { kind: "reporter"; id: "reporter" };
export type Access = "read" | "report" | "human";
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: { currentVersion: number },
  ) {
    super(code);
  }
}
export function validateEnvelope(
  headers: { host?: string | null; origin?: string | null },
  port: number,
) {
  if (
    !headers.host ||
    ![`127.0.0.1:${port}`, `localhost:${port}`].includes(headers.host)
  )
    throw new HttpError(403, "host_rejected");
  if (
    headers.origin !== undefined &&
    headers.origin !== null &&
    ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(
      headers.origin,
    )
  )
    throw new HttpError(403, "origin_rejected");
}
export function authorize(
  principal: Principal,
  access: Access,
  fetchSite?: string | null,
) {
  if (principal.kind === "reporter" && access === "human")
    throw new HttpError(403, "human_required");
  if (
    principal.kind === "browser" &&
    fetchSite &&
    !["same-origin", "none"].includes(fetchSite)
  )
    throw new HttpError(403, "fetch_site_rejected");
  return principal;
}
export function authenticate(
  headers: Headers,
  store: Store,
  credentials: Credentials,
  access: Access,
  authenticated?: () => void,
): Principal {
  const bearer = headers.get("authorization");
  let secret: string | undefined;
  try {
    secret = cookieSecret(headers.get("cookie"));
  } catch {
    throw new HttpError(403, "ambiguous_auth");
  }
  if (bearer && secret !== undefined)
    throw new HttpError(403, "ambiguous_auth");
  if (bearer) {
    if (
      !/^Bearer [a-f0-9]{64}$/.test(bearer) ||
      !equalSecret(bearer.slice(7), credentials.reporterToken)
    )
      throw new HttpError(401, "authentication_required");
    authenticated?.();
    return authorize({ kind: "reporter", id: "reporter" }, access);
  }
  const session = secret ? store.session(hashSecret(secret)) : null;
  if (!session) throw new HttpError(401, "authentication_required");
  authenticated?.();
  return authorize(
    { kind: "browser", id: "operator", sessionId: session.id },
    access,
    headers.get("sec-fetch-site"),
  );
}
export function requireBrowserMutation(headers: Headers) {
  if (!headers.get("origin")) throw new HttpError(403, "origin_required");
  if (headers.get("authorization")) throw new HttpError(403, "human_required");
  if (
    (headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new HttpError(415, "json_required");
  const site = headers.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site))
    throw new HttpError(403, "fetch_site_rejected");
}
export function rejectReadBody(request: IncomingMessage) {
  if (!["GET", "HEAD"].includes(request.method || "GET")) return;
  const length = request.headers["content-length"];
  if (length && !/^\d+$/.test(length)) throw new HttpError(400, "body_invalid");
  if (length && Number(length) > 65536)
    throw new HttpError(413, "body_too_large");
  if (request.headers["transfer-encoding"] || Number(length || 0) !== 0)
    throw new HttpError(400, "body_not_allowed");
}
export async function boundedBody(request: IncomingMessage): Promise<Buffer> {
  const length = request.headers["content-length"];
  if (length && (!/^\d+$/.test(length) || Number(length) > 65536))
    throw new HttpError(413, "body_too_large");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      cleanup();
      reject(new HttpError(408, "body_timeout"));
    }, 5000);
    function cleanup() {
      clearTimeout(timer);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
    }
    function onError() {
      cleanup();
      reject(new HttpError(400, "body_invalid"));
    }
    function onData(chunk: Buffer) {
      size += chunk.length;
      if (size > 65536) {
        cleanup();
        request.pause();
        reject(new HttpError(413, "body_too_large"));
      } else chunks.push(chunk);
    }
    function onEnd() {
      cleanup();
      resolve(Buffer.concat(chunks));
    }
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}
export function publicError(error: unknown) {
  if (isConflict(error))
    return {
      status:
        error.code === "resource_not_found"
          ? 404
          : error.code === "human_required"
            ? 403
            : error.code === "cursor_invalid"
              ? 400
              : 409,
      code: error.code,
      details:
        error.currentVersion === undefined
          ? undefined
          : { currentVersion: error.currentVersion },
    };
  if (error instanceof HttpError)
    return { status: error.status, code: error.code, details: error.details };
  const code = (error as { code?: string })?.code;
  if (code && /^SQLITE_(BUSY|LOCKED)/.test(code))
    return { status: 503, code: "database_busy" };
  return { status: 503, code: "unavailable" };
}

export function requireResourceMutation(
  headers: Headers,
  principal: Principal,
) {
  if (principal.kind === "browser") requireBrowserMutation(headers);
  else {
    if (headers.get("origin")) throw new HttpError(403, "origin_rejected");
    if (
      (headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !==
      "application/json"
    )
      throw new HttpError(415, "json_required");
  }
}
export class MutationBudget {
  private tokens = 200;
  private at: number;
  constructor(now = performance.now()) {
    this.at = now;
  }
  charge(now = performance.now()) {
    this.tokens = Math.min(200, this.tokens + Math.max(0, now - this.at) / 10);
    this.at = now;
    if (this.tokens < 1) throw new HttpError(429, "rate_limited");
    this.tokens--;
  }
}
