import { expect, test, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { ApiClient } from "../../src/client/api";
const effects = vi.hoisted(() => ({ current: null as (() => (() => void)) | null }));
vi.mock("react", () => ({ useEffect: (effect: () => (() => void)) => { effects.current = effect; } }));
import { useTracking } from "../../src/client/tracking-owner";
const generation = "86abc230-e4a0-4c68-9dd8-777a0bbfb93d";
class Source {
  static all: Source[] = [];
  listeners = new Map<string, (event: unknown) => void>();
  onopen?: () => void;
  onerror?: () => void;
  closed = false;
  constructor(public url: string) { Source.all.push(this); }
  close() { this.closed = true; }
  addEventListener(name: string, callback: (event: unknown) => void) { this.listeners.set(name, callback); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); Source.all = []; });
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function OwnerHarness(probeCursor = "100") {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", Source);
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
  const cache = new QueryClient();
  cache.setQueryData([generation, "/tasks"], { generation, snapshotCursor: "100", data: [] });
  const api = new ApiClient(generation, () => {}, async () => Response.json({ generation, snapshotCursor: probeCursor, data: { timezone: "UTC", version: 2, dataLocation: "/synthetic", storageBytes: 0, storageMeasurement: "observational" } }));
  useTracking(api, cache, generation, 0, () => {}, () => {});
  const cleanup = effects.current!();
  Source.all[0].onopen!();
  return { cache, cleanup };
}
test("replacement stream replays a frame received inside the recovery barrier before its invalidation timer", async () => {
  const { cache, cleanup } = OwnerHarness();
  let inject = false;
  vi.spyOn(cache, "refetchQueries").mockImplementation(async () => {
    if (inject) { inject = false; Source.all.at(-1)!.listeners.get("change")!({ lastEventId: "101", data: JSON.stringify({ entityType: "task", entityId: "synthetic", kind: "updated" }) }); }
  });
  try {
    Source.all[0].onerror!(); await settle();
    inject = true;
    await vi.advanceTimersByTimeAsync(5000); await settle();
    expect(Source.all.at(-1)!.url).toContain("after=100&");
    expect(Source.all[0].closed).toBe(true);
  } finally { cleanup(); cache.clear(); }
});
test("same-generation supported ahead reset starts the replacement from coordinated fresh snapshots", async () => {
  const { cache, cleanup } = OwnerHarness("80");
  vi.spyOn(cache, "refetchQueries").mockImplementation(async () => { cache.setQueryData([generation, "/tasks"], { generation, snapshotCursor: "80", data: [] }); });
  try {
    Source.all[0].listeners.get("reset")!({ data: JSON.stringify({ reason: "cursor_ahead", generation }) }); await settle();
    await vi.advanceTimersByTimeAsync(5000); await settle();
    expect(Source.all.at(-1)!.url).toContain("after=80&");
  } finally { cleanup(); cache.clear(); }
});
