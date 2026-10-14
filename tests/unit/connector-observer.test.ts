import { describe, expect, it, vi } from "vitest";
import { ConnectorObserver, type ConnectorSourceReader, type SourceDetail, type SourceIndex } from "../../src/integrations/connector/observer";
import type { ConnectorChat } from "../../src/contracts/connectors";

const chat = (id: string, over: Partial<ConnectorChat> = {}): ConnectorChat => ({ id, title: "t " + id, cwd: null, updatedAt: "2026-01-01T00:00:00.000Z", parentId: null, agentNickname: null, agentRole: null, model: null, status: "unknown", statusSource: "stored", archived: false, ...over });
const messages = { connected: "ok", partial: "partial", detail: "detail", stale: "stale", unavailable: "down" };
const all = { kind: "all", limit: 30, archived: "false" } as const;

function fake(index: () => Promise<SourceIndex>, detail?: (c: ConnectorChat) => Promise<SourceDetail>) {
  const loadIndex = vi.fn(index);
  const readDetail = vi.fn(detail ?? (async (c: ConnectorChat) => ({ chat: c, turns: [], nextTurnsCursor: null })));
  const source: ConnectorSourceReader = { messages, loadIndex, readDetail: readDetail as never, beginClosing() {}, close: async () => {} };
  return { source, loadIndex, readDetail };
}

describe("ConnectorObserver", () => {
  it("caches within the TTL and dedupes in-flight loads", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = fake(async () => { await gate; return { chats: [chat("a")], partial: false }; });
    const observer = new ConnectorObserver(f.source, { cacheTtlMs: 60_000 });
    const pending = [observer.list(all), observer.list(all)];
    release();
    await Promise.all(pending);
    await observer.list(all);
    expect(f.loadIndex).toHaveBeenCalledTimes(1);
    const expired = fake(async () => ({ chats: [], partial: false }));
    const uncached = new ConnectorObserver(expired.source, { cacheTtlMs: 0 });
    await uncached.list(all);
    await uncached.list(all);
    expect(expired.loadIndex).toHaveBeenCalledTimes(2);
  });

  it("falls back to stale data after a later failure and is unavailable when the first load fails", async () => {
    let fail = false;
    const f = fake(async () => { if (fail) throw new Error("boom"); return { chats: [chat("a")], partial: false }; });
    const observer = new ConnectorObserver(f.source, { cacheTtlMs: 0 });
    expect((await observer.list(all)).connection.state).toBe("connected");
    fail = true;
    const stale = await observer.list(all);
    expect(stale.connection).toMatchObject({ state: "stale", message: "stale" });
    expect(stale.data.map((c) => c.id)).toEqual(["a"]);
    const down = await new ConnectorObserver(fake(async () => { throw new Error("x"); }).source).list(all);
    expect(down).toMatchObject({ connection: { state: "unavailable", observedAt: null, message: "down" }, data: [], nextCursor: null });
  });

  it("scopes list cursors to the query", async () => {
    const f = fake(async () => ({ chats: [chat("a", { title: "alpha" }), chat("b", { title: "alpha two" }), chat("c", { title: "other" })], partial: false }));
    const observer = new ConnectorObserver(f.source, { cacheTtlMs: 60_000 });
    const first = await observer.list({ ...all, limit: 1, search: "alpha" });
    expect(first.nextCursor).toBeTruthy();
    expect((await observer.list({ ...all, limit: 1, search: "alpha", cursor: first.nextCursor! })).data).toHaveLength(1);
    await expect(observer.list({ ...all, limit: 1, search: "other", cursor: first.nextCursor! })).rejects.toThrow();
  });

  it("caps the index at 10,000 chats and marks it partial", async () => {
    const chats = Array.from({ length: 10_005 }, (_, i) => chat("c" + i));
    const observer = new ConnectorObserver(fake(async () => ({ chats, partial: false })).source);
    const page = await observer.list({ ...all, limit: 100 });
    expect(page.connection).toMatchObject({ state: "connected", message: "partial" });
    let cursor = page.nextCursor, count = page.data.length;
    while (cursor) { const next = await observer.list({ ...all, limit: 100, cursor }); count += next.data.length; cursor = next.nextCursor; }
    expect(count).toBe(10_000);
  });

  it("drops invalid chats from the index", async () => {
    const bad = { ...chat("bad"), status: "nonsense" } as unknown as ConnectorChat;
    const observer = new ConnectorObserver(fake(async () => ({ chats: [chat("good"), bad], partial: false })).source);
    expect((await observer.list(all)).data.map((c) => c.id)).toEqual(["good"]);
  });

  it("rejects invalid detail output through the source-error path", async () => {
    const f = fake(async () => ({ chats: [chat("a")], partial: false }), async (c) => ({ chat: c, turns: [{ nope: 1 }] as never, nextTurnsCursor: null }));
    await expect(new ConnectorObserver(f.source).detail("a")).rejects.toThrow("Connector source unavailable");
    const tooMany = fake(async () => ({ chats: [chat("a")], partial: false }), async (c) => ({ chat: c, turns: Array.from({ length: 101 }, (_, i) => ({ id: "t" + i, status: "done", startedAt: null, completedAt: null, request: null, latestMessage: null, planText: null, tasks: [], progress: null })), nextTurnsCursor: null }));
    await expect(new ConnectorObserver(tooMany.source).detail("a")).rejects.toThrow("Connector source unavailable");
  });

  it("paginates child agents at 30", async () => {
    const kids = Array.from({ length: 35 }, (_, i) => chat("k" + String(i).padStart(2, "0"), { parentId: "p" }));
    const observer = new ConnectorObserver(fake(async () => ({ chats: [chat("p"), ...kids], partial: false })).source, { cacheTtlMs: 60_000 });
    const first = await observer.detail("p");
    expect(first.data.agents).toHaveLength(30);
    expect(first.data.nextAgentsCursor).toBeTruthy();
    const second = await observer.detail("p", { agentsCursor: first.data.nextAgentsCursor! });
    expect(second.data.agents).toHaveLength(5);
    expect(second.data.nextAgentsCursor).toBeNull();
    await expect(observer.detail("other", { agentsCursor: first.data.nextAgentsCursor! })).rejects.toThrow();
  });

  it("allows at most 4 concurrent detail loads", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const ids = ["a", "b", "c", "d", "e"];
    const f = fake(async () => ({ chats: ids.map((id) => chat(id)), partial: false }), async (c) => { await gate; return { chat: c, turns: [], nextTurnsCursor: null }; });
    const observer = new ConnectorObserver(f.source, { cacheTtlMs: 60_000 });
    await observer.list(all);
    const started = ids.slice(0, 4).map((id) => observer.detail(id));
    await expect(observer.detail("e")).rejects.toThrow("Connector source unavailable");
    release();
    await Promise.all(started);
    await expect(observer.detail("e")).resolves.toBeTruthy();
  });
});
