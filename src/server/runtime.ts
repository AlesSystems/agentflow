import { HistoryRuntime } from "../history/runtime";
import type { ConnectorSource } from "../contracts/connectors";
import type { ConnectorObserver } from "../integrations/connector/observer";
import { GithubCoordinator } from "../integrations/github/coordinator";
import type { openOwnedStore } from "../db";
import type { RuntimeConfig } from "./config";
import { HttpError, validateEnvelope } from "./security";
type Owned = Awaited<ReturnType<typeof openOwnedStore>>;
type Runtime = {
  kind: "ready" | "closing";
  config: RuntimeConfig;
  owned: Owned;
  identity: object;
  github: GithubCoordinator;
  history: HistoryRuntime;
  connectors: Partial<Record<ConnectorSource, ConnectorObserver>>;
};
const key = Symbol.for("agentflow.live-runtime");
const globalRuntime = globalThis as typeof globalThis & {
  [key]: Runtime | undefined;
};
export function publishRuntime(config: RuntimeConfig, owned: Owned, github=new GithubCoordinator(owned.store,config.githubTokenFile), history?:HistoryRuntime, connectors: Partial<Record<ConnectorSource, ConnectorObserver>> = {}) {
  if (globalRuntime[key]) throw new Error("RUNTIME_ALREADY_OWNED");
  globalRuntime[key] = {
    kind: "ready",
    github,
    history:history ?? new HistoryRuntime(owned.store),
    connectors,
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
  if (state) {state.kind = "closing";state.github.beginClosing();state.history.beginClosing();for (const connector of Object.values(state.connectors)) connector?.beginClosing();}
}
export function clearRuntime() {
  delete globalRuntime[key];
}
