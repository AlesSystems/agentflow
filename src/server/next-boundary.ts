import "server-only";
import { guard } from "./runtime";
import { authenticate, publicError } from "./security";
import type { Access } from "./security";
export function privateContext(
  headers: Headers,
  access: Access = "read",
  authenticated?: (generation: string) => void,
) {
  const state = guard(headers);
  const principal = authenticate(
    headers,
    state.owned.store,
    state.owned.credentials,
    access,
    () => authenticated?.(state.owned.store.metadata().generation),
  );
  return { ...state, principal };
}
export function json(value: unknown, status = 200, extra: HeadersInit = {}) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...extra },
  });
}
export function failure(error: unknown, generation?: string) {
  const result = publicError(error);
  return json(
    {
      error: {
        code: result.code,
        ...("details" in result && result.details
          ? { details: result.details }
          : {}),
        message:
          "The request could not be completed. Check the local service and request.",
      },
    },
    result.status,
    {
      ...([429, 503].includes(result.status) ? { "Retry-After": "1" } : {}),
      ...(generation ? { "AgentFlow-Generation": generation } : {}),
    },
  );
}
