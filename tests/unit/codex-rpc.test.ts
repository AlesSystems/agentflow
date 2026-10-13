import { describe, expect, it } from "vitest";
import { CodexRpc } from "../../src/integrations/codex/rpc";
import { resolve } from "node:path";
const fixture = resolve("tests/fixtures/codex-server.mjs");
describe("Codex read-only subprocess", () => {
  it("initializes, correlates responses and rejects mutation methods", async () => {
    const rpc = new CodexRpc({ executable: process.execPath, args: [fixture], timeoutMs: 500 });
    try {
      expect(await rpc.request("thread/list", {})).toEqual({ data: [], nextCursor: null });
      await expect(rpc.request("thread/start" as never, {})).rejects.toThrow("unsupported");
    } finally { await rpc.close(); }
  });
  it("times out safely and can reconnect after a failed request", async () => {
    const rpc = new CodexRpc({ executable: process.execPath, args: [fixture], timeoutMs: 100 });
    try {
      await expect(rpc.request("thread/read", { threadId: "timeout" })).rejects.toThrow("unavailable");
      expect(await rpc.request("thread/list", {})).toEqual({ data: [], nextCursor: null });
    } finally { await rpc.close(); }
  });
  it("rejects oversized frames and never exposes source errors", async () => {
    const rpc = new CodexRpc({ executable: process.execPath, args: [fixture], timeoutMs: 500, maxFrameBytes: 1024 });
    try {
      await expect(rpc.request("thread/read", { threadId: "large" })).rejects.toThrow("unavailable");
      await expect(rpc.request("thread/read", { threadId: "error" })).rejects.not.toThrow("SECRET");
      rpc.beginClosing();
      await expect(rpc.request("thread/list", {})).rejects.toThrow("unavailable");
    } finally { await rpc.close(); }
  });
});
