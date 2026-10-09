import type { openOwnedStore } from "../db";
import type { RuntimeConfig } from "./config";
import { HttpError, validateEnvelope } from "./security";
type Owned = Awaited<ReturnType<typeof openOwnedStore>>;
type Runtime = {
  kind: "ready" | "closing";
  config: RuntimeConfig;
  owned: Owned;
  identity: object;
};
const key = Symbol.for("agentflow.live-runtime");
const globalRuntime = globalThis as typeof globalThis & {
  [key]: Runtime | undefined;
};
export function publishRuntime(config: RuntimeConfig, owned: Owned) {
  if (globalRuntime[key]) throw new Error("RUNTIME_ALREADY_OWNED");
  globalRuntime[key] = {
    kind: "ready",
    config,
    owned,
    identity: Object.freeze({}),
  };
}
export function runtime() {
  const state = globalRuntime[key];
  if (!state || state.kind !== "ready" || !state.identity)
    throw new HttpError(503, "unavailable");
  state.owned.instance.assertOwned();
  return state;
}
export function guard(headers: Headers) {
  const state = runtime();
  validateEnvelope(
    { host: headers.get("host"), origin: headers.get("origin") },
    state.config.port,
  );
  return state;
}
export function beginClosing() {
  const state = globalRuntime[key];
  if (state) state.kind = "closing";
}
export function clearRuntime() {
  delete globalRuntime[key];
}
