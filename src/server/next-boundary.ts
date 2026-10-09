import "server-only";
import { guard } from "./runtime";
import { authenticate, publicError } from "./security";
import type { Access } from "./security";
export function privateContext(headers: Headers, access: Access = "read") {
  const state = guard(headers);
  const principal = authenticate(
    headers,
    state.owned.store,
    state.owned.credentials,
    access,
  );
  return { ...state, principal };
}
export function json(value: unknown, status = 200, extra: HeadersInit = {}) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...extra },
  });
}
export function failure(error: unknown) {
  const result = publicError(error);
  return json(
    {
      error: {
        code: result.code,
        message:
          "The request could not be completed. Check the local service and request.",
      },
    },
    result.status,
    result.status === 503 ? { "Retry-After": "1" } : {},
  );
}
