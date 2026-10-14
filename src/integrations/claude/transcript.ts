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
  for (const line of options.maxLines === undefined ? lines : options.maxLines > 0 ? lines.slice(-options.maxLines) : []) {
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

const skipPrefixes = ["<local-command-stdout>", "<local-command-caveat>", "<local-command-stderr>", "<task-notification>", "<bash-stdout>", "<bash-stderr>", "<system-reminder>", "[Request interrupted by user"];
const skipped = (raw: string) => { const head = raw.trimStart(); return skipPrefixes.some((prefix) => head.startsWith(prefix)); };
const tag = (raw: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(raw)?.[1].trim() ?? "";
/** Slash-command records become "/x args"; null when the text is not one. */
function slashCommand(raw: string): string | null {
  const head = raw.trimStart();
  if (!head.startsWith("<command-name>") && !head.startsWith("<command-message>")) return null;
  const name = tag(head, "command-name");
  if (!name) return null;
  const args = tag(head, "command-args");
  return `${name.startsWith("/") ? name : "/" + name}${args ? " " + args : ""}`;
}

/** Raw (unredacted) request text, or null when the record is not a user request. */
function requestRaw(record: Rec): string | null { return requestInfo(record)?.raw ?? null; }
function requestInfo(record: Rec): { raw: string; command: boolean } | null {
  if (record.type === "attachment") {
    const attachment = object(record.attachment);
    const prompt = attachment.prompt;
    if (attachment.type !== "queued_command" || attachment.commandMode !== "prompt" || typeof prompt !== "string" || !prompt || skipped(prompt)) return null;
    return { raw: prompt, command: false };
  }
  if (record.type !== "user" || record.isMeta || record.isCompactSummary || record.toolUseResult !== undefined) return null;
  const kind = object(record.origin).kind;
  if (typeof kind === "string" && kind !== "human") return null;
  const content = object(record.message).content;
  let raw: string | null = null;
  if (typeof content === "string") raw = content;
  else if (Array.isArray(content)) {
    const parts = blocks(content);
    if (parts.some((b) => b.type === "tool_result")) return null;
    const texts = parts.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text as string).filter((t) => !t.trimStart().startsWith("<system-reminder>"));
    raw = texts.length ? texts.join("\n") : null;
  }
  if (!raw || skipped(raw)) return null;
  const command = slashCommand(raw);
  return command === null ? { raw, command: false } : { raw: command, command: true };
}
const request = (record: Rec, limit: number) => { const raw = requestRaw(record); return raw === null ? null : text(raw, limit); };

export function deriveIndexFields(records: Rec[]): IndexFields {
  const fields: IndexFields = { cwd: null, customTitle: null, firstRequest: null, updatedAt: null, agentName: null, model: null };
  for (const record of records) {
    if (fields.cwd === null && typeof record.cwd === "string") fields.cwd = text(record.cwd, 4000);
    const at = iso(record.timestamp); if (at) fields.updatedAt = at;
    if (record.type === "custom-title") fields.customTitle = text(record.customTitle) ?? fields.customTitle;
    else if (record.type === "agent-name") fields.agentName = text(record.agentName, 1000) ?? fields.agentName;
    else if (record.type === "assistant") { const model = object(record.message).model; if (typeof model === "string" && model !== "<synthetic>") fields.model = text(model, 1000) ?? fields.model; }
    else if (fields.firstRequest === null) { const info = requestInfo(record); if (info && !info.command) fields.firstRequest = text(info.raw, 2000); }
  }
  return fields;
}

const statuses = new Set<string>(["pending", "in_progress", "completed"]);
const taskStatus = (value: unknown): Status => typeof value === "string" && statuses.has(value) ? value as Status : "pending";
const subject = (value: unknown) => text(value) ?? "Task";

type Draft = { id: string; startedAt: string | null; request: string | null; completedAt: string | null; texts: Map<string, string[]>; last: string | null; touched: boolean; tasks: Task[] };

export function buildTurns(records: Rec[], options: TurnOptions): ConnectorTurn[] {
  const list = new Map<string, Task>();
  const pendingCreates = new Set<string>();
  const idOf = (value: unknown) => typeof value === "string" && value ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : null;
  const snapshot = () => [...list.values()].map((task) => ({ ...task }));
  const drafts: Draft[] = [];
  let turn: Draft | null = null;
  const replace = (items: [string, Task][]) => { list.clear(); for (const [id, task] of items) list.set(id, task); if (turn) turn.touched = true; };
  const seen = new Set<string>();
  for (const record of records) {
    if (typeof record.uuid === "string") { if (seen.has(record.uuid)) continue; seen.add(record.uuid); }
    const req = request(record, 4000);
    if (requestRaw(record) !== null && req !== null) {
      if (turn) turn.tasks = snapshot();
      const uuid = record.uuid;
      turn = { id: typeof uuid === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(uuid) ? uuid : `turn-${drafts.length + 1}`, startedAt: iso(record.timestamp), request: req, completedAt: null, texts: new Map(), last: null, touched: false, tasks: [] };
      drafts.push(turn);
      continue;
    }
    if (record.type === "user") {
      const content = object(record.message).content;
      for (const block of blocks(content)) {
        if (block.type !== "tool_result" || typeof block.tool_use_id !== "string" || !pendingCreates.delete(block.tool_use_id)) continue;
        const task = object(object(record.toolUseResult).task);
        const id = idOf(task.id);
        if (id !== null) { list.set(id, { subject: subject(task.subject), status: "pending" }); if (turn) turn.touched = true; }
      }
      continue;
    }
    if (record.type === "attachment") {
      const attachment = object(record.attachment);
      if (attachment.type === "task_reminder") replace(blocks(attachment.content).flatMap((item, i): [string, Task][] => item.subject === undefined && item.id === undefined ? [] : [[idOf(item.id) ?? `reminder-${i}`, { subject: subject(item.subject), status: taskStatus(item.status) }]]));
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
        if (block.name === "TaskCreate" && typeof block.id === "string") pendingCreates.add(block.id);
        else if (block.name === "TaskUpdate" && idOf(input.taskId) !== null) {
          const taskId = idOf(input.taskId)!;
          const current = list.get(taskId);
          if (input.status === "deleted") { if (list.delete(taskId) && turn) turn.touched = true; }
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
  const ordered = drafts.map((draft, position) => ({ draft, position }))
    .sort((a, b) => (a.draft.startedAt === null) !== (b.draft.startedAt === null) ? (a.draft.startedAt === null ? 1 : -1)
      : a.draft.startedAt !== null && b.draft.startedAt !== null && a.draft.startedAt !== b.draft.startedAt ? (a.draft.startedAt < b.draft.startedAt ? -1 : 1) : a.position - b.position)
    .map((entry) => entry.draft);
  return ordered.map((draft, index) => {
    const inProgress = options.running && index === ordered.length - 1;
    const tasks = draft.touched ? draft.tasks.map((task) => ({ text: task.subject, status: task.status })) : [];
    const completed = tasks.filter((task) => task.status === "completed").length;
    const latest = draft.last ? text(draft.texts.get(draft.last)!.join("\n"), 4000) : null;
    return connectorTurn.parse({ id: draft.id, status: inProgress ? "inProgress" : "recorded", startedAt: draft.startedAt, completedAt: inProgress ? null : draft.completedAt, request: draft.request, latestMessage: latest, planText: null, tasks,
      progress: tasks.length ? { completed, total: tasks.length, percent: Math.round(completed / tasks.length * 100) } : null });
  });
}
