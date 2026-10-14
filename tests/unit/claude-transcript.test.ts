import { describe, expect, it } from "vitest";
import { buildTurns, deriveIndexFields, parseLines } from "../../src/integrations/claude/transcript";
import { secretToken, sentinels, sessionALines } from "../fixtures/claude-home";

const records = () => parseLines(sessionALines().join("\n"));
const line = (o: Record<string, unknown>) => JSON.stringify(o);

describe("Claude transcript parsing", () => {
  it("drops partial and unparseable lines but keeps unknown record types", () => {
    const parsed = parseLines('{"type":"a"}\nnot json\n[1]\n{"type":"b"}\n{"type":"c","x');
    expect(parsed.map((r) => r.type)).toEqual(["a", "b"]);
    expect(parseLines('rest of line"}\n{"type":"a"}\n{"type":"b"}', { dropFirst: true }).map((r) => r.type)).toEqual(["a", "b"]);
    expect(parseLines('{"type":"a"}\n{"type":"b"}\n{"type":"c"}', { maxLines: 2 }).map((r) => r.type)).toEqual(["b", "c"]);
    expect(records().some((r) => r.type === "weird-future-type")).toBe(true);
  });

  it("derives index fields with last-wins semantics", () => {
    expect(deriveIndexFields(records())).toEqual({
      cwd: "/work/alpha", customTitle: "Second title", agentName: "alpha-agent", model: "claude-opus-x",
      firstRequest: `Build the alpha feature with token [redacted]`, updatedAt: "2026-01-01T00:00:23.000Z",
    });
    expect(deriveIndexFields([])).toEqual({ cwd: null, customTitle: null, agentName: null, model: null, firstRequest: null, updatedAt: null });
  });

  it("groups turns by request, skipping meta, summaries, command output and tool results", () => {
    const turns = buildTurns(records(), { running: false });
    expect(turns.map((x) => x.id)).toEqual(["u1", "u2", "u3"]);
    expect(turns[1]).toMatchObject({ request: "Second request\nwith two blocks", latestMessage: "Second reply", status: "recorded", planText: null, startedAt: "2026-01-01T00:00:16.000Z", completedAt: "2026-01-01T00:00:20.000Z" });
    expect(turns[0]).toMatchObject({ latestMessage: "Done with turn one", completedAt: "2026-01-01T00:00:14.000Z" });
  });

  it("marks only the last turn inProgress when running", () => {
    const turns = buildTurns(records(), { running: true });
    expect(turns.map((x) => [x.status, x.completedAt === null])).toEqual([["recorded", false], ["recorded", false], ["inProgress", true]]);
  });

  it("replays TaskCreate/TaskUpdate, then TodoWrite, then lets a reminder override", () => {
    const turns = buildTurns(records(), { running: false });
    expect(turns[0].tasks).toEqual([{ text: "Write parser", status: "completed" }, { text: "Write tests", status: "pending" }]);
    expect(turns[0].progress).toEqual({ completed: 1, total: 2, percent: 50 });
    expect(turns[1].tasks.map((x) => x.text)).toEqual(["A", "B", "C"]);
    expect(turns[1].progress).toEqual({ completed: 1, total: 3, percent: 33 });
    expect(turns[2].tasks).toEqual([{ text: "Reminder one", status: "in_progress" }, { text: "Reminder two", status: "completed" }]);
  });

  it("carries the running list into turns without task events and deletes on status deleted", () => {
    const base = [
      line({ type: "user", uuid: "q1", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "one" } }),
      line({ type: "assistant", timestamp: "2026-01-01T00:00:02.000Z", message: { id: "x", content: [{ type: "tool_use", name: "TodoWrite", input: { todos: [{ content: "A", status: "pending" }] } }] } }),
      line({ type: "user", uuid: "q2", timestamp: "2026-01-01T00:00:03.000Z", message: { role: "user", content: "two" } }),
    ];
    const turns = buildTurns(parseLines(base.join("\n")), { running: false });
    expect(turns[0].tasks).toHaveLength(1);
    expect(turns[1].tasks).toEqual([]);
    expect(turns[1].progress).toBeNull();
    const deleted = [
      ...base.slice(0, 1),
      line({ type: "assistant", timestamp: "2026-01-01T00:00:02.000Z", message: { id: "y", content: [{ type: "tool_use", id: "tc1", name: "TaskCreate", input: { subject: "S" } }] } }),
      line({ type: "user", uuid: "r", timestamp: "2026-01-01T00:00:02.500Z", toolUseResult: { task: { id: "9", subject: "S" } }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tc1", content: "ok" }] } }),
      line({ type: "assistant", timestamp: "2026-01-01T00:00:03.000Z", message: { id: "z", content: [{ type: "tool_use", name: "TaskUpdate", input: { taskId: "9", status: "deleted" } }] } }),
    ];
    expect(buildTurns(parseLines(deleted.join("\n")), { running: false })[0]).toMatchObject({ tasks: [], progress: null });
  });

  it("joins assistant text blocks per message id, keeps records before the first request out of turns, and falls back on invalid ids", () => {
    const input = [
      line({ type: "assistant", timestamp: "2026-01-01T00:00:00.000Z", message: { id: "pre", content: [{ type: "text", text: "orphan" }] } }),
      line({ type: "user", timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: "hello" } }),
      line({ type: "assistant", timestamp: "2026-01-01T00:00:02.000Z", message: { id: "m", content: [{ type: "text", text: "part1" }] } }),
      line({ type: "assistant", timestamp: "2026-01-01T00:00:03.000Z", message: { id: "m", content: [{ type: "text", text: "part2" }] } }),
    ];
    const turns = buildTurns(parseLines(input.join("\n")), { running: false });
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ id: "turn-1", latestMessage: "part1\npart2" });
  });

  it("never emits thinking, tool inputs, tool results, attachments or secrets", () => {
    const out = JSON.stringify([buildTurns(records(), { running: true }), deriveIndexFields(records())]);
    for (const sentinel of [sentinels.thinking, sentinels.toolInput, sentinels.toolResult, sentinels.hook, secretToken]) expect(out).not.toContain(sentinel);
    expect(out).toContain("[redacted]");
  });

  const u = (n: number, content: unknown, extra: Record<string, unknown> = {}) => line({ type: "user", uuid: `x${n}`, timestamp: `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`, message: { role: "user", content }, ...extra });
  const a = (n: number, id: string, block: Record<string, unknown>) => line({ type: "assistant", timestamp: `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`, message: { id, content: [block] } });

  it("does not treat notifications, bash output or interrupts as requests", () => {
    const S = "SENTINEL-NOTIFY-1";
    const input = [
      u(1, "real one"), a(2, "m1", { type: "text", text: "ok" }),
      u(3, `<task-notification>${S}</task-notification>`, { origin: { kind: "task-notification" } }),
      u(4, `${S} from agent`, { origin: { kind: "peer" } }),
      u(5, `<bash-stdout>${S}</bash-stdout>`), u(6, `<bash-stderr>${S}</bash-stderr>`), u(7, `<local-command-stderr>${S}</local-command-stderr>`),
      u(8, `[Request interrupted by user for tool use] ${S}`), u(9, `<task-notification>${S}</task-notification>`),
      u(10, "human one", { origin: { kind: "human" } }),
    ];
    const turns = buildTurns(parseLines(input.join("\n")), { running: false });
    expect(turns).toHaveLength(2);
    expect(JSON.stringify([turns, deriveIndexFields(parseLines(input.join("\n")))])).not.toContain(S);
  });

  it("starts turns from queued prompt attachments with the same skip rules", () => {
    const att = (n: number, attachment: Record<string, unknown>) => line({ type: "attachment", uuid: `q${n}`, timestamp: `2026-01-01T00:00:0${n}.000Z`, attachment });
    const input = [u(1, "first"), att(2, { type: "queued_command", commandMode: "prompt", prompt: `queued ${secretToken}` }), att(3, { type: "queued_command", commandMode: "bash", prompt: "no" }), att(4, { type: "queued_command", commandMode: "prompt", prompt: "<task-notification>x</task-notification>" })];
    const turns = buildTurns(parseLines(input.join("\n")), { running: false });
    expect(turns.map((t) => t.id)).toEqual(["x1", "q2"]);
    expect(turns[1].request).toBe("queued [redacted]");
  });

  it("pairs TaskCreate only by tool_use_id and handles numeric ids", () => {
    const input = [
      u(1, "go"),
      a(2, "m1", { type: "tool_use", id: "tcFail", name: "TaskCreate", input: { subject: "S" } }),
      u(3, [{ type: "tool_result", tool_use_id: "tcFail", is_error: true, content: "nope" }], { toolUseResult: "Error" }),
      u(4, [{ type: "tool_result", tool_use_id: "tuGet", content: "x" }], { toolUseResult: { task: { id: "5", subject: "Fetched" } } }),
      a(5, "m2", { type: "tool_use", id: "tcOk", name: "TaskCreate", input: { subject: "Real" } }),
      u(6, [{ type: "tool_result", tool_use_id: "tcOk", content: "x" }], { toolUseResult: { task: { id: 7, subject: "Real" } } }),
      a(7, "m3", { type: "tool_use", id: "tu", name: "TaskUpdate", input: { taskId: 7, status: "completed" } }),
      line({ type: "attachment", timestamp: "2026-01-01T00:00:08.000Z", attachment: { type: "task_reminder", content: [{ id: 3, subject: "Num", status: "pending" }] } }),
      a(9, "m4", { type: "tool_use", id: "tu2", name: "TaskUpdate", input: { taskId: 3, status: "completed" } }),
    ];
    const [turn] = buildTurns(parseLines(input.join("\n")), { running: false });
    expect(turn.tasks).toEqual([{ text: "Num", status: "completed" }]);
    const before = buildTurns(parseLines(input.slice(0, 7).join("\n")), { running: false })[0];
    expect(before.tasks).toEqual([{ text: "Real", status: "completed" }]);
  });

  it("keeps the last maxLines lines", () => {
    expect(parseLines('{"n":1}\n{"n":2}\n{"n":3}', { maxLines: 2 }).map((r) => r.n)).toEqual([2, 3]);
  });

  it("truncates agent name and model at 1000 characters", () => {
    const fields = deriveIndexFields([{ type: "agent-name", agentName: "n ".repeat(750) }, { type: "assistant", message: { model: "m ".repeat(750) } }]);
    expect(fields.agentName).toHaveLength(1000);
    expect(fields.model).toHaveLength(1000);
  });
});
