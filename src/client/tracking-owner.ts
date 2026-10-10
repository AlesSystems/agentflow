import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { ApiClient, ApiError } from "./api";
import { settingsResponse } from "../contracts/responses";
import { resetNotice } from "../contracts/stream";
import { safeCursor, ReplayCursor, type Connection } from "./tracking";
export function useTracking(api: ApiClient, cache: QueryClient, generation: string, paired: number, update: (connection: Connection) => void, pair: () => void) {
  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let owner = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let invalidation: ReturnType<typeof setTimeout> | undefined;
    let refreshing = false;
    let fallback = false;
    let failures = 0;
    let lastSuccess: number | null = null;
    let state: Connection["state"] = "connecting";
    let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const replay = new ReplayCursor(safeCursor(cache.getQueryCache().getAll().map(q => q.state.data), generation));
    let resetCursor = false;
    const current = () => !disposed && api.generation === generation;
    function publish(next: Connection["state"]) { state = next; if (current()) update({ state, lastSuccess }); }
    function close() { owner++; source?.close(); source = null; replay.discardPending(); if (invalidation) { clearTimeout(invalidation); invalidation = undefined; void cache.invalidateQueries({ predicate: q => q.queryKey[0] === generation, refetchType: "none" }); } }
    function schedule() {
      clearTimeout(timer);
      if (!current() || state === "authentication-required") return;
      timer = setTimeout(() => void refresh(fallback), fallback ? Math.min(30000, 5000 * 2 ** failures) : 15000);
    }
    async function refresh(reconnect: boolean) {
      if (!current() || refreshing) return;
      if (document.visibilityState === "hidden") { schedule(); return; }
      refreshing = true;
      try {
        const probe = await api.read("/settings", settingsResponse);
        if (!current()) return;
        // Retained entries become stale before any replacement stream is admitted.
        await cache.invalidateQueries({ predicate: q => q.queryKey[0] === generation, refetchType: "none" });
        await cache.refetchQueries({ predicate: q => q.queryKey[0] === generation, type: "active" }, { throwOnError: true });
        if (!current()) return;
        lastSuccess = Date.now(); failures = 0;
        if (resetCursor) { replay.rebase([probe, ...cache.getQueryCache().getAll().map(q => q.state.data)], generation); resetCursor = false; }
        if (reconnect) connect(); else publish(state);
      } catch (error) {
        if (!current()) return;
        if (error instanceof ApiError && error.status === 401) { close(); publish("authentication-required"); pair(); }
        else { failures = Math.min(failures + 1, 3); if (fallback) publish("polling"); }
      } finally { refreshing = false; schedule(); }
    }
    function recover() {
      if (!current()) return;
      close(); fallback = true; publish("recovering");
      void refresh(false);
    }
    function connect() {
      if (!current()) return;
      close();
      const epoch = owner;
      const next = new EventSource(`/api/v1/changes/stream?after=${replay.after}&generation=${generation}`);
      source = next;
      const valid = () => current() && source === next && owner === epoch;
      next.onopen = () => { if (!valid()) return; fallback = false; failures = 0; publish("connected"); schedule(); };
      next.addEventListener("change", event => {
        if (!valid()) return;
        try {
          const message = event as MessageEvent<string>;
          const cursor = replay.offer(message.lastEventId, message.data);
          if (!cursor) return;
          if (!invalidation) invalidation = setTimeout(() => {
            invalidation = undefined;
            if (valid()) replay.flush(() => { void cache.invalidateQueries({ predicate: q => q.queryKey[0] === generation }); });
          }, 50);

        } catch { recover(); }
      });
      next.addEventListener("reset", event => {
        if (!valid()) return;
        try { resetNotice.parse(JSON.parse((event as MessageEvent<string>).data)); } catch { /* The authenticated probe remains the authority. */ }
        resetCursor = true;
        recover();
      });
      next.onerror = () => {
        if (!valid()) return;
        // Native reconnect retains Last-Event-ID. Probe before manually replacing it.
        fallback = true; publish("polling");
        void refresh(false);
      };
    }
    function visible() {
      if (document.visibilityState === "hidden") return;
      const nextZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (nextZone !== timezone) timezone = nextZone;
      void refresh(fallback);
    }
    const unsubscribe = cache.getQueryCache().subscribe(event => {
      if (event.type === "updated" && event.action.type === "success" && current()) {
        lastSuccess = Math.max(lastSuccess ?? 0, event.query.state.dataUpdatedAt);
        update({ state, lastSuccess });
      }
    });
    publish("connecting"); connect(); schedule();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => { disposed = true; close(); clearTimeout(timer); clearTimeout(invalidation); unsubscribe(); document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", visible); };
  }, [api, cache, generation, paired, update, pair]);
}
