import { connectorTurn, type ConnectorTurn } from "../../contracts/connectors";
import { object, text } from "../codex/normalize";

export type IndexFields = { cwd: string | null; customTitle: string | null; firstRequest: string | null; updatedAt: string | null; agentName: string | null; model: string | null };
export type TurnOptions = { running: boolean };
type Rec = Record<string, unknown>;
type Status = "pending" | "in_progress" | "completed";
type Task = { subject: string; status: Status };

export function parseLines(raw: string, options: { dropFirst?: boolean; maxLines?: number } = {}): Rec[] {
  const lines = raw.split("\n");
  if (options.dropFirst) lines.shift();
  const out: Rec[] = [];
  for (const line of lines.slice(0, options.maxLines ?? lines.length)) {
    if (!line.startsWith("{")) continue;
    try { const value: unknown = JSON.parse(line); if (value !== null && typeof value === "object" && !Array.isArray(value)) out.push(value as Rec); } catch { /* partial or corrupt line */ }
  }
  return out;
}

const iso = (value: unknown): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const blocks = (value: unknown): Rec[] => Array.isArray(value) ? value.map(object) : [];

/** Raw (unredacted) request text, or null when the record is not a user request. */
function requestRaw(record: Rec): string | null {
  if (record.type !== "user" || record.isMeta || record.isCompactSummary || record.toolUseResult !== undefined) return null;
  const content = object(record.message).content;
  let raw: string | null = null;
  if (typeof content === "string") raw = content;
  else if (Array.isArray(content)) {
    const parts = blocks(content);
    if (parts.some((b) => b.type === "tool_result")) return null;
    const texts = parts.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text as string);
    raw = texts.length ? texts.join("\n") : null;
  }
  if (!raw || raw.startsWith("<local-command-stdout>") || raw.startsWith("<local-command-caveat>")) return null;
  return raw;
}
const request = (record: Rec, limit: number) => { const raw = requestRaw(record); return raw === null ? null : text(raw, limit); };

export function deriveIndexFields(records: Rec[]): IndexFields {
  const fields: IndexFields = { cwd: null, customTitle: null, firstRequest: null, updatedAt: null, agentName: null, model: null };
  for (const record of records) {
    if (fields.cwd === null && typeof record.cwd === "string") fields.cwd = text(record.cwd, 4000);
    const at = iso(record.timestamp); if (at) fields.updatedAt = at;
    if (record.type === "custom-title") fields.customTitle = text(record.customTitle) ?? fields.customTitle;
    else if (record.type === "agent-name") fields.agentName = text(record.agentName) ?? fields.agentName;
    else if (record.type === "assistant") { const model = object(record.message).model; if (typeof model === "string" && model !== "<synthetic>") fields.model = text(model) ?? fields.model; }
    else if (fields.firstRequest === null) fields.firstRequest = request(record, 2000);
  }
  return fields;
}

const statuses = new Set<string>(["pending", "in_progress", "completed"]);
const taskStatus = (value: unknown): Status => typeof value === "string" && statuses.has(value) ? value as Status : "pending";
const subject = (value: unknown) => text(value) ?? "Task";

type Draft = { id: string; startedAt: string | null; request: string | null; completedAt: string | null; texts: Map<string, string[]>; last: string | null; touched: boolean; tasks: Task[] };

export function buildTurns(records: Rec[], options: TurnOptions): ConnectorTurn[] {
  const list = new Map<string, Task>();
  let pendingCreates = 0;
  const snapshot = () => [...list.values()].map((task) => ({ ...task }));
  const drafts: Draft[] = [];
  let turn: Draft | null = null;
  const replace = (items: [string, Task][]) => { list.clear(); for (const [id, task] of items) list.set(id, task); if (turn) turn.touched = true; };
  for (const record of records) {
    const req = request(record, 4000);
    if (requestRaw(record) !== null && req !== null) {
      if (turn) turn.tasks = snapshot();
      const uuid = record.uuid;
      turn = { id: typeof uuid === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(uuid) ? uuid : `turn-${drafts.length + 1}`, startedAt: iso(record.timestamp), request: req, completedAt: null, texts: new Map(), last: null, touched: false, tasks: [] };
      drafts.push(turn);
      continue;
    }
    if (record.type === "user") {
      const task = object(object(record.toolUseResult).task);
      if (pendingCreates > 0 && typeof task.id === "string" && task.id && record.toolUseResult !== undefined) {
        pendingCreates--; list.set(task.id, { subject: subject(task.subject), status: "pending" }); if (turn) turn.touched = true;
      }
      continue;
    }
    if (record.type === "attachment") {
      const attachment = object(record.attachment);
      if (attachment.type === "task_reminder") replace(blocks(attachment.content).flatMap((item, i): [string, Task][] => item.subject === undefined && item.id === undefined ? [] : [[typeof item.id === "string" && item.id ? item.id : `reminder-${i}`, { subject: subject(item.subject), status: taskStatus(item.status) }]]));
      continue;
    }
    if (record.type !== "assistant") continue;
    const message = object(record.message);
    const at = iso(record.timestamp);
    if (turn && at) turn.completedAt = at;
    for (const block of blocks(message.content)) {
      if (block.type === "text" && typeof block.text === "string" && block.text && turn) {
        const key = typeof message.id === "string" && message.id ? message.id : `anon-${turn.texts.size}`;
        const parts = turn.texts.get(key) ?? []; parts.push(block.text); turn.texts.set(key, parts); turn.last = key;
      } else if (block.type === "tool_use") {
        const input = object(block.input);
        if (block.name === "TaskCreate") pendingCreates++;
        else if (block.name === "TaskUpdate" && typeof input.taskId === "string") {
          const current = list.get(input.taskId);
          if (input.status === "deleted") { if (list.delete(input.taskId) && turn) turn.touched = true; }
          else if (current) {
            if (typeof input.status === "string" && statuses.has(input.status)) current.status = input.status as Status;
            if (typeof input.subject === "string" && input.subject) current.subject = subject(input.subject);
            if (turn) turn.touched = true;
          }
        } else if (block.name === "TodoWrite" && Array.isArray(input.todos)) {
          replace(blocks(input.todos).map((todo, i): [string, Task] => [`todo-${i}`, { subject: subject(todo.content), status: taskStatus(todo.status) }]));
        }
      }
    }
  }
  if (turn) turn.tasks = snapshot();
  return drafts.map((draft, index) => {
    const inProgress = options.running && index === drafts.length - 1;
    const tasks = draft.touched ? draft.tasks.map((task) => ({ text: task.subject, status: task.status })) : [];
    const completed = tasks.filter((task) => task.status === "completed").length;
    const latest = draft.last ? text(draft.texts.get(draft.last)!.join("\n"), 4000) : null;
    return connectorTurn.parse({ id: draft.id, status: inProgress ? "inProgress" : "recorded", startedAt: draft.startedAt, completedAt: inProgress ? null : draft.completedAt, request: draft.request, latestMessage: latest, planText: null, tasks,
      progress: tasks.length ? { completed, total: tasks.length, percent: Math.round(completed / tasks.length * 100) } : null });
  });
}
