import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const sentinels = { history: "SENTINEL-HISTORY-9f31", key: "SENTINEL-KEY-77ab", thinking: "SENTINEL-THINKING-12cd", toolInput: "SENTINEL-TOOLINPUT-55ef", toolResult: "SENTINEL-TOOLRESULT-88aa", hook: "SENTINEL-HOOK-31bc", settings: "SENTINEL-SETTINGS-4d4d" };
export const secretToken = "sk-abcdefghijklmnop1234567890";
export const deadPid = 999999;

const rec = (r: Record<string, unknown>) => JSON.stringify(r);
const t = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
const user = (n: number, uuid: string, content: unknown, extra: Record<string, unknown> = {}, cwd = "/work/alpha", sessionId = "sess-a") => rec({ type: "user", uuid, timestamp: t(n), cwd, sessionId, isSidechain: false, message: { role: "user", content }, ...extra });
const assistant = (n: number, id: string, block: Record<string, unknown>, model = "claude-opus-x") => rec({ type: "assistant", uuid: `a-${n}`, timestamp: t(n), message: { id, model, role: "assistant", content: [block] } });
const toolUse = (n: number, id: string, name: string, input: Record<string, unknown>) => assistant(n, id, { type: "tool_use", id: `tu-${n}`, name, input });
const toolResult = (n: number, extra: Record<string, unknown>) => user(n, `r-${n}`, [{ type: "tool_result", tool_use_id: `tu-${n - 1}`, content: sentinels.toolResult }], extra);

export function sessionALines(): string[] {
  return [
    user(1, "c0", "This session is being continued from a compacted summary", { isCompactSummary: true }),
    user(2, "u1", `Build the alpha feature with token ${secretToken}`),
    assistant(3, "m1", { type: "thinking", thinking: sentinels.thinking }),
    assistant(4, "m1", { type: "text", text: "Planning alpha" }),
    assistant(5, "m1", { type: "text", text: "Starting now" }),
    toolUse(6, "m2", "TaskCreate", { subject: "Write parser", description: "d" }),
    toolResult(7, { toolUseResult: { task: { id: "1", subject: "Write parser" } } }),
    toolUse(8, "m3", "TaskCreate", { subject: "Write tests" }),
    toolResult(9, { toolUseResult: { task: { id: "2", subject: "Write tests" } } }),
    toolUse(10, "m4", "TaskUpdate", { taskId: "1", status: "completed" }),
    toolResult(11, { toolUseResult: { success: true } }),
    toolUse(12, "m5", "Bash", { command: sentinels.toolInput }),
    toolResult(13, { toolUseResult: sentinels.toolResult }),
    assistant(14, "m6", { type: "text", text: "Done with turn one" }),
    rec({ type: "custom-title", customTitle: "First title", sessionId: "sess-a" }),
    rec({ type: "system", subtype: "compact_boundary", timestamp: t(15) }),
    rec({ type: "weird-future-type", payload: sentinels.hook }),
    rec({ type: "attachment", timestamp: t(15), attachment: { type: "hook_success", content: sentinels.hook } }),
    user(16, "u2", [{ type: "text", text: "Second request" }, { type: "text", text: "with two blocks" }]),
    user(17, "meta1", "meta caveat text", { isMeta: true }),
    user(18, "stdout1", "<local-command-stdout>ignored</local-command-stdout>"),
    assistant(19, "m7", { type: "text", text: "Second reply" }),
    toolUse(20, "m8", "TodoWrite", { todos: [{ content: "A", status: "completed" }, { content: "B", status: "in_progress" }, { content: "C", status: "pending" }] }),
    user(21, "u3", "Third request"),
    assistant(22, "m9", { type: "text", text: "Third reply" }, "<synthetic>"),
    rec({ type: "attachment", timestamp: t(23), attachment: { type: "task_reminder", itemCount: 2, content: [{ id: "7", subject: "Reminder one", status: "in_progress", blocks: [], blockedBy: [] }, { id: "8", subject: "Reminder two", status: "completed" }] } }),
    rec({ type: "custom-title", customTitle: "Second title", sessionId: "sess-a" }),
    rec({ type: "agent-name", agentName: "alpha-agent" }),
    '{"type":"assistant","timestamp":"2026-01-01T00:00:59.000Z","message":{"id":"mx","content":[{"type":"te',
  ];
}

export type ClaudeHome = { root: string; livePid: number; deadPid: number; paths: Record<string, string>; write(rel: string, body: string): string; cleanup(): void };

export function createClaudeHome(): ClaudeHome {
  const root = mkdtempSync(join(tmpdir(), "claude-home-"));
  const write = (rel: string, body: string) => { const full = join(root, rel); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, body); return full; };
  const lines = (list: string[]) => list.join("\n");
  const paths = {
    a: write("projects/-work-alpha/sess-a.jsonl", lines(sessionALines())),
    b: write("projects/-work-beta/sess-b.jsonl", lines([
      user(1, "b1", "Beta request", {}, "/work/beta", "sess-b"),
      assistant(2, "bm1", { type: "text", text: "Beta reply" }, "claude-sonnet-y"),
      assistant(3, "bm2", { type: "text", text: "Beta synthetic" }, "<synthetic>"),
    ]) + "\n"),
    agent: write("projects/-work-alpha/sess-a/subagents/agent-ag1.jsonl", lines([
      user(30, "s1", "Subtask prompt", { isSidechain: true }),
      assistant(31, "sm1", { type: "text", text: "Subtask result" }),
    ]) + "\n"),
    meta: write("projects/-work-alpha/sess-a/subagents/agent-ag1.meta.json", JSON.stringify({ agentType: "Explore", description: "Find stuff", spawnDepth: 1, toolUseId: "tu-x" })),
    workflow: write("projects/-work-alpha/sess-a/subagents/workflows/wf_1/agent-ag2.jsonl", lines([
      user(40, "w1", "Workflow prompt", { isSidechain: true }),
      assistant(41, "wm1", { type: "text", text: "Workflow result" }),
    ]) + "\n"),
  };
  write(`sessions/${process.pid}.json`, JSON.stringify({ pid: process.pid, sessionId: "sess-a", cwd: "/work/alpha", status: "busy", updatedAt: Date.now() }));
  write(`sessions/${deadPid}.json`, JSON.stringify({ pid: deadPid, sessionId: "sess-b", cwd: "/work/beta", status: "busy", updatedAt: Date.now() }));
  write(`sessions/${process.pid}.deadbeef.key`, sentinels.key);
  write("history.jsonl", rec({ display: sentinels.history }) + "\n");
  write("settings.json", JSON.stringify({ secret: sentinels.settings }));
  write(".credentials.json", JSON.stringify({ token: sentinels.key }));
  return { root, livePid: process.pid, deadPid, paths, write, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
