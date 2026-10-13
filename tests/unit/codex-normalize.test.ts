import { describe, expect, it } from "vitest";
import { normalizeChat, normalizeTurn } from "../../src/integrations/codex/normalize";
describe("Codex observations", () => {
  it("recognizes persisted legacy children without claiming live activity", () => {
    const chat = normalizeChat({ id: "child", name: "Agent", source: { subAgent: { thread_spawn: { parent_thread_id: "parent", agent_nickname: "Worker", agent_role: "worker" } } }, status: { type: "active" }, updatedAt: 1700000000 }, false);
    expect(chat).toMatchObject({ parentId: "parent", agentNickname: "Worker", agentRole: "worker", statusSource: "stored", status: "unknown" });
  });
  it("does not turn prose percentages or a completed turn into checklist acceptance", () => {
    const turn = normalizeTurn({ id: "turn", status: "completed", items: [{ type: "userMessage", content: [{ type: "text", text: "SECRET token abcdefghijklmnopqrstuvwxyz123456" }] }, { type: "agentMessage", text: "100% complete" }, { type: "plan", text: "Everything is 100% complete" }] });
    expect(turn.progress).toBeNull(); expect(turn.tasks).toEqual([]); expect(turn.status).toBe("completed");
    expect(turn.request).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });
  it("extracts only explicit structured steps, preserving their actual status", () => {
    const turn = normalizeTurn({ id: "turn", status: "inProgress", items: [{ type: "plan", text: JSON.stringify({ plan: [{ step: "Build", status: "completed" }, { step: "Review", status: "in_progress" }] }) }] });
    expect(turn.progress).toEqual({ completed: 1, total: 2, percent: 50 });
    expect(turn.tasks).toEqual([{ text: "Build", status: "completed" }, { text: "Review", status: "in_progress" }]);
  });
  it("rejects malformed identities and drops reasoning or tool output", () => {
    expect(() => normalizeChat({ id: "../bad" }, false)).toThrow();
    expect(normalizeTurn({ id: "turn", items: [{ type: "reasoning", text: "SECRET" }, { type: "commandExecution", aggregatedOutput: "SECRET" }] }).latestMessage).toBeNull();
  });
});
