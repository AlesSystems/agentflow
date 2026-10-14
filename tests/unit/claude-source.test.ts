import * as realFs from "node:fs/promises";
import { appendFileSync, mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeObserver, type ClaudeFs } from "../../src/integrations/claude/source";
import { ClaudeSource } from "../../src/integrations/claude/source";
import { createClaudeHome, secretToken, sentinels, type ClaudeHome } from "../fixtures/claude-home";

let home: ClaudeHome | undefined;
afterEach(() => { home?.cleanup(); home = undefined; });
const setup = () => (home = createClaudeHome());
const all = { limit: 100, archived: "false" as const, kind: "all" as const };
const allowed = [
  /^projects\/[^/]+\/[^/]+\.jsonl$/,
  /^projects\/[^/]+\/[^/]+\/subagents\/agent-[^/]+\.(jsonl|meta\.json)$/,
  /^projects\/[^/]+\/[^/]+\/subagents\/workflows\/wf_[^/]+\/agent-[^/]+\.(jsonl|meta\.json)$/,
  /^sessions\/\d+\.json$/,
];
function spyFs(root: string) {
  const opened: string[] = [];
  const fs: ClaudeFs = { ...realFs, open: ((path: string, ...rest: unknown[]) => { opened.push(relative(root, String(path))); return (realFs.open as (...a: unknown[]) => unknown)(path, ...rest); }) as ClaudeFs["open"] };
  return { fs, opened };
}

describe("Claude source reader", () => {
  it("indexes main sessions, subagents and workflow agents with parent links", async () => {
    const h = setup();
    const observer = createClaudeObserver({ root: h.root, cacheTtlMs: 0 });
    const list = await observer.list(all);
    expect(list.connection).toMatchObject({ state: "connected", message: "Local Claude Code transcripts. Running status comes from live Claude Code processes." });
    const byId = Object.fromEntries(list.data.map((chat) => [chat.id, chat]));
    expect(Object.keys(byId).sort()).toEqual(["ag1", "ag2", "sess-a", "sess-b"]);
    expect(byId["sess-a"]).toMatchObject({ title: "Second title", cwd: "/work/alpha", parentId: null, agentNickname: "alpha-agent", agentRole: null, model: "claude-opus-x", archived: false, updatedAt: "2026-01-01T00:00:23.000Z" });
    expect(byId["sess-b"]).toMatchObject({ title: "Beta request", cwd: "/work/beta", model: "claude-sonnet-y", agentNickname: null });
    expect(byId.ag1).toMatchObject({ title: "Subtask prompt", parentId: "sess-a", agentNickname: "Find stuff", agentRole: "Explore", status: "unknown", statusSource: "stored" });
    expect(byId.ag2).toMatchObject({ parentId: "sess-a", agentNickname: null, agentRole: null });
    expect((await observer.list({ ...all, kind: "chats" })).data.map((x) => x.id).sort()).toEqual(["sess-a", "sess-b"]);
    await observer.close();
  });

  it("uses live process files for status and falls back to stored for dead pids", async () => {
    const h = setup();
    const observer = createClaudeObserver({ root: h.root, cacheTtlMs: 0 });
    const byId = Object.fromEntries((await observer.list(all)).data.map((chat) => [chat.id, chat]));
    expect(byId["sess-a"]).toMatchObject({ status: "running", statusSource: "live" });
    expect(byId["sess-b"]).toMatchObject({ status: "unknown", statusSource: "stored" });
    h.write(`sessions/${h.livePid}.json`, JSON.stringify({ pid: h.livePid, sessionId: "sess-a", status: "idle" }));
    expect((await observer.list(all)).data.find((x) => x.id === "sess-a")).toMatchObject({ status: "idle", statusSource: "live" });
    await observer.close();
  });

  it("reuses cached chats for unchanged files and re-reads changed ones", async () => {
    const h = setup();
    const { fs, opened } = spyFs(h.root);
    const source = new ClaudeSource({ root: h.root, fs });
    await source.loadIndex();
    const transcripts = () => opened.filter((p) => p.startsWith("projects/")).length;
    const first = transcripts();
    expect(first).toBeGreaterThanOrEqual(4);
    await source.loadIndex();
    expect(transcripts()).toBe(first);
    appendFileSync(h.paths.b, JSON.stringify({ type: "custom-title", customTitle: "Beta renamed" }) + "\n");
    utimesSync(h.paths.b, new Date(), new Date(Date.now() + 5000));
    const index = await source.loadIndex();
    expect(transcripts()).toBeGreaterThan(first);
    expect(index.chats.find((c) => c.id === "sess-b")?.title).toBe("Beta renamed");
  });

  it("flags partial results beyond the file cap and throws when projects is missing", async () => {
    const h = setup();
    const capped = await new ClaudeSource({ root: h.root, maxFiles: 2 }).loadIndex();
    expect(capped.partial).toBe(true);
    expect(capped.chats.length).toBeLessThanOrEqual(2);
    await expect(new ClaudeSource({ root: h.root + "-missing" }).loadIndex()).rejects.toThrow();
    const observer = createClaudeObserver({ root: h.root + "-missing" });
    expect(await observer.list(all)).toMatchObject({ connection: { state: "unavailable" }, data: [] });
    const empty = createClaudeHome();
    rmSync(join(empty.root, "projects"), { recursive: true, force: true });
    empty.write("projects/.keep", "");
    const list = await createClaudeObserver({ root: empty.root, cacheTtlMs: 0 }).list(all);
    expect(list).toMatchObject({ connection: { state: "connected" }, data: [] });
    empty.cleanup();
  });

  it("returns turns newest first, pages with cursors and rejects invalid or foreign cursors", async () => {
    const h = setup();
    const observer = createClaudeObserver({ root: h.root, cacheTtlMs: 0 });
    const detail = await observer.detail("sess-a");
    expect(detail.connection.message).toContain("bounded recent window");
    expect(detail.data.chat).toMatchObject({ id: "sess-a", status: "running", title: "Second title" });
    expect(detail.data.turns.map((x) => x.id)).toEqual(["u3", "u2", "u1"]);
    expect(detail.data.turns[0]).toMatchObject({ status: "inProgress", completedAt: null, latestMessage: "Third reply", progress: { completed: 1, total: 2, percent: 50 } });
    expect(detail.data.turns[1].progress).toEqual({ completed: 1, total: 3, percent: 33 });
    expect(detail.data.agents.map((x) => x.id).sort()).toEqual(["ag1", "ag2"]);
    expect(detail.data.nextTurnsCursor).toBeNull();
    expect((await observer.detail("sess-b")).data.turns[0]).toMatchObject({ status: "recorded", request: "Beta request", latestMessage: "Beta synthetic" });
    await expect(observer.detail("sess-a", { turnsCursor: "garbage" })).rejects.toThrow();
    const foreign = Buffer.from(JSON.stringify({ offset: 1, scope: "turns:other" })).toString("base64url");
    await expect(observer.detail("sess-a", { turnsCursor: foreign })).rejects.toThrow();
    await expect(observer.detail("missing")).rejects.toThrow();
    await observer.close();
  });

  it("pages turns 10 at a time", async () => {
    const h = setup();
    const many = Array.from({ length: 12 }, (_, i) => [
      JSON.stringify({ type: "user", uuid: `p${i}`, timestamp: new Date(Date.UTC(2026, 1, 1, 0, 0, i)).toISOString(), cwd: "/p", message: { role: "user", content: `req ${i}` } }),
      JSON.stringify({ type: "assistant", timestamp: new Date(Date.UTC(2026, 1, 1, 0, 0, i, 500)).toISOString(), message: { id: `pm${i}`, content: [{ type: "text", text: `reply ${i}` }] } }),
    ]).flat();
    h.write("projects/-p/paged.jsonl", many.join("\n") + "\n");
    const observer = createClaudeObserver({ root: h.root, cacheTtlMs: 0 });
    const first = await observer.detail("paged");
    expect(first.data.turns.map((x) => x.id)).toEqual(Array.from({ length: 10 }, (_, i) => `p${11 - i}`));
    expect(first.data.nextTurnsCursor).not.toBeNull();
    const second = await observer.detail("paged", { turnsCursor: first.data.nextTurnsCursor! });
    expect(second.data.turns.map((x) => x.id)).toEqual(["p1", "p0"]);
    expect(second.data.nextTurnsCursor).toBeNull();
    await observer.close();
  });

  it("returns unique turns, newest first, when a transcript replays earlier records", async () => {
    const h = setup();
    const ts = (i: number, ms = 0) => new Date(Date.UTC(2026, 1, 1, 0, 0, i, ms)).toISOString();
    const pair = (i: number) => [
      JSON.stringify({ type: "user", uuid: `p${i}`, timestamp: ts(i), cwd: "/p", message: { role: "user", content: `req ${i}` } }),
      JSON.stringify({ type: "assistant", uuid: `a${i}`, timestamp: ts(i, 500), message: { id: `pm${i}`, content: [{ type: "text", text: `reply ${i}` }] } }),
    ];
    const lines = [...Array.from({ length: 12 }, (_, i) => pair(i)).flat(), ...[0, 1, 2].flatMap(pair), ...[12, 13].flatMap(pair)];
    h.write("projects/-p/replay.jsonl", lines.join("\n") + "\n");
    const observer = createClaudeObserver({ root: h.root, cacheTtlMs: 0 });
    const first = await observer.detail("replay");
    const second = await observer.detail("replay", { turnsCursor: first.data.nextTurnsCursor! });
    const ids = [...first.data.turns, ...second.data.turns].map((x) => x.id);
    expect(ids).toEqual(Array.from({ length: 14 }, (_, i) => `p${13 - i}`));
    expect(second.data.nextTurnsCursor).toBeNull();
    expect(first.data.turns[0].latestMessage).toBe("reply 13");
    await observer.close();
  });

  it("keeps detail updatedAt in agreement with the list and refuses reads after closing", async () => {
    const h = setup();
    h.write("projects/-p/agree.jsonl", JSON.stringify({ type: "user", uuid: "g1", timestamp: "2020-01-01T00:00:00.000Z", cwd: "/p", message: { role: "user", content: "hi" } }) + "\n");
    const observer = createClaudeObserver({ root: h.root, cacheTtlMs: 0 });
    const listed = (await observer.list(all)).data.find((c) => c.id === "agree")!;
    const detail = await observer.detail("agree");
    expect(detail.data.chat.updatedAt).toBe(listed.updatedAt);
    await observer.close();
    const closed = createClaudeObserver({ root: h.root, cacheTtlMs: 0 });
    await closed.close();
    await expect(closed.detail("agree")).rejects.toThrow();
  });

  it("never leaks thinking, tool content, hidden files or secrets, and redacts request text", async () => {
    const h = setup();
    const observer = createClaudeObserver({ root: h.root, cacheTtlMs: 0 });
    const out = JSON.stringify([await observer.list(all), await observer.detail("sess-a"), await observer.detail("ag1")]);
    for (const sentinel of Object.values(sentinels)) expect(out).not.toContain(sentinel);
    expect(out).not.toContain(secretToken);
    expect(out).toContain("[redacted]");
    await observer.close();
  });

  it("opens only the three allowed path shapes", async () => {
    const h = setup();
    const { fs, opened } = spyFs(h.root);
    const observer = createClaudeObserver({ root: h.root, cacheTtlMs: 0, fs });
    await observer.list(all); await observer.detail("sess-a"); await observer.detail("ag2");
    expect(opened.length).toBeGreaterThan(0);
    for (const path of opened) {
      expect(path.endsWith(".key")).toBe(false);
      expect(path).not.toBe("history.jsonl");
      expect(allowed.some((re) => re.test(path)), path).toBe(true);
    }
    await observer.close();
  });

  const rec = (o: Record<string, unknown>) => JSON.stringify(o);
  const ts = (n: number) => new Date(Date.UTC(2026, 2, 1, 0, 0, n)).toISOString();

  it("does not index a symlinked subagents directory pointing outside the root", async () => {
    const h = setup();
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    try {
      writeFileSync(join(outside, "agent-evil.jsonl"), rec({ type: "user", uuid: "e", timestamp: ts(1), message: { role: "user", content: "evil" } }) + "\n");
      mkdirSync(join(h.root, "projects/-work-gamma/sess-g"), { recursive: true });
      writeFileSync(join(h.root, "projects/-work-gamma/sess-g.jsonl"), rec({ type: "user", uuid: "g", timestamp: ts(1), message: { role: "user", content: "g" } }) + "\n");
      symlinkSync(outside, join(h.root, "projects/-work-gamma/sess-g/subagents"));
      const ids = (await new ClaudeSource({ root: h.root }).loadIndex()).chats.map((c) => c.id);
      expect(ids).toContain("sess-g");
      expect(ids).not.toContain("evil");
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });

  it("refuses to open a transcript symlinked outside the root", async () => {
    const h = setup();
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    try {
      writeFileSync(join(outside, "x.jsonl"), rec({ type: "user", uuid: "e", timestamp: ts(1), message: { role: "user", content: "SENTINEL-OUTSIDE" } }) + "\n");
      symlinkSync(join(outside, "x.jsonl"), join(h.root, "projects/-work-beta/linked.jsonl"));
      const out = JSON.stringify(await new ClaudeSource({ root: h.root }).loadIndex());
      expect(out).not.toContain("SENTINEL-OUTSIDE");
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });

  it("keeps a subagent whose meta description exceeds 1000 characters", async () => {
    const h = setup();
    h.write("projects/-work-alpha/sess-a/subagents/agent-ag1.meta.json", JSON.stringify({ agentType: "Explore", description: "d ".repeat(750) }));
    const list = await createClaudeObserver({ root: h.root, cacheTtlMs: 0 }).list(all);
    expect(list.data.find((c) => c.id === "ag1")?.agentNickname).toHaveLength(1000);
  });

  it("uses the later of the tail timestamp and mtime for large files and extends the tail for huge last lines", async () => {
    const h = setup();
    const big = "x ".repeat(150_000);
    const lines = [rec({ type: "user", uuid: "l1", timestamp: ts(1), cwd: "/big", message: { role: "user", content: "start" } }), rec({ type: "assistant", timestamp: ts(2), message: { id: "f", model: "filler", content: [{ type: "text", text: big }] } }), rec({ type: "assistant", timestamp: ts(3), message: { id: "z", model: "last-model", content: [{ type: "text", text: big }] } })];
    const path = h.write("projects/-big/big.jsonl", lines.join("\n") + "\n");
    const mtime = new Date("2026-06-01T00:00:00.000Z");
    utimesSync(path, mtime, mtime);
    const chat = (await new ClaudeSource({ root: h.root }).loadIndex()).chats.find((c) => c.id === "big")!;
    expect(chat.model).toBe("last-model");
    expect(chat.updatedAt).toBe(mtime.toISOString());
  });

  it("treats EPERM as not alive", async () => {
    const h = setup();
    const kill = process.kill;
    process.kill = ((pid: number, signal?: number) => { if (pid === h.livePid && signal === 0) throw Object.assign(new Error("perm"), { code: "EPERM" }); return kill(pid, signal as never); }) as typeof process.kill;
    try {
      const chat = (await new ClaudeSource({ root: h.root }).loadIndex()).chats.find((c) => c.id === "sess-a");
      expect(chat).toMatchObject({ status: "unknown", statusSource: "stored" });
    } finally { process.kill = kill; }
  });

  it("keeps the stored cwd when a detail read is truncated", async () => {
    const h = setup();
    const filler = rec({ type: "assistant", timestamp: ts(2), cwd: "/changed", message: { id: "f", content: [{ type: "text", text: "y".repeat(1000) }] } });
    const head = rec({ type: "user", uuid: "t1", timestamp: ts(1), cwd: "/orig", message: { role: "user", content: "start" } });
    h.write("projects/-trunc/trunc.jsonl", head + "\n" + Array.from({ length: 17_500 }, () => filler).join("\n") + "\n");
    const observer = createClaudeObserver({ root: h.root, cacheTtlMs: 0 });
    expect((await observer.detail("trunc")).data.chat.cwd).toBe("/orig");
    await observer.close();
  });

  it("does not reopen or re-parse an unchanged transcript on repeated detail reads", async () => {
    const h = setup();
    const { fs, opened } = spyFs(h.root);
    const observer = createClaudeObserver({ root: h.root, cacheTtlMs: 0, fs });
    await observer.detail("sess-b");
    const count = () => opened.filter((p) => p.endsWith("sess-b.jsonl")).length;
    const first = count();
    await observer.detail("sess-b");
    expect(count()).toBe(first);
    appendFileSync(h.paths.b, rec({ type: "user", uuid: "b9", timestamp: ts(9), message: { role: "user", content: "again" } }) + "\n");
    expect((await observer.detail("sess-b")).data.turns[0].request).toBe("again");
    expect(count()).toBeGreaterThan(first);
    await observer.close();
  });
});
