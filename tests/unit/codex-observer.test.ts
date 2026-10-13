import { describe, expect, it } from "vitest";
import { resolve, join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { CodexObserver } from "../../src/integrations/codex/observer";
const options = { executable: process.execPath, args: [resolve("tests/fixtures/codex-observer.mjs")], timeoutMs: 1000 };
describe("Codex history observer", () => {
  it("paginates chats and legacy child agents across archived source pages", async () => {
    const observer = new CodexObserver(options);
    try {
      const first = await observer.list({ limit: 1, archived: "false", kind: "chats" });
      expect(first.data.map((x) => x.id)).toEqual(["chat-b"]);
      expect(first.connection.state).toBe("connected");
      const second = await observer.list({ limit: 1, archived: "false", kind: "chats", cursor: first.nextCursor! });
      expect(second.data.map((x) => x.id)).toEqual(["chat-a"]);
      const detail = await observer.detail("chat-a");
      expect(detail.data.agents.map((x) => x.id)).toEqual(["child"]);
      expect(detail.data.turns[0]).toMatchObject({ request: "Build a connector", latestMessage: "Working", progress: null, tasks: [] });
      expect(detail.data.chat.status).toBe("unknown");
      expect((await observer.list({ limit: 30, archived: "true", kind: "all" })).data.map((x) => x.id)).toEqual(["child"]);
    } finally { await observer.close(); }
  });
  it("reports source failures safely and can reconnect", async () => {
    const observer = new CodexObserver({ ...options, executable: "/missing/codex" });
    try {
      expect(await observer.list({ limit: 30, archived: "false", kind: "all" })).toMatchObject({ connection: { state: "unavailable" }, data: [] });
    } finally { await observer.close(); }
  });
  it("retains successful observations as stale on refresh failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-test-")); const failure = join(dir, "failure");
    const observer = new CodexObserver({ ...options, args: [...options.args, failure], cacheTtlMs: 0 });
    try {
      await observer.list({ limit: 30, archived: "false", kind: "chats" });
      await observer.detail("chat-a");
      writeFileSync(failure, "fail");
      const list = await observer.list({ limit: 30, archived: "false", kind: "chats" });
      expect(list.connection.state).toBe("stale"); expect(list.data).toHaveLength(2);
      const detail = await observer.detail("chat-a");
      expect(detail.connection.state).toBe("stale"); expect(detail.data.turns[0].request).toBe("Build a connector");
      expect(JSON.stringify(detail)).not.toContain("PRIVATE");
    } finally { await observer.close(); rmSync(dir, { recursive: true }); }
  });
  it("marks bounded observations as partial", async () => {
    const observer = new CodexObserver({ ...options, maxThreads: 1 });
    try {
      expect((await observer.list({ limit: 30, archived: "false", kind: "all" })).connection.message).toContain("partial");
    } finally { await observer.close(); }
  });
  it("retains the partial warning when the final archived page exceeds the remaining capacity", async () => {
    const observer = new CodexObserver({ ...options, args: [...options.args, "--overflow"], maxThreads: 4 });
    try {
      const result = await observer.list({ limit: 30, archived: "true", kind: "all" });
      expect(result.data).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
      expect(result.connection.message).toContain("partial");
    } finally { await observer.close(); }
  });
});
