import { z } from "zod";
import { codexChat, codexTurn, type CodexChat, type CodexTurn } from "../../contracts/codex";

export const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const text = (value: unknown, limit = 2000): string | null => typeof value === "string" && value.length ? value
  .replace(/\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{20,}|[a-fA-F0-9]{48,}|[a-zA-Z0-9_-]{32,})\b/g, "[redacted]")
  .replace(/(\b(?:authorization|password|api[_-]?key|access[_-]?token|secret|token)(?:\s*[:=]\s*|\s+))([^\s,;]+)/gi, "$1[redacted]").slice(0, limit) : null;
const timestamp = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 253402300799 ? new Date(value * 1000).toISOString() : null;
const checklist = z.array(z.object({ step: z.string().min(1).max(2000), status: z.enum(["pending", "in_progress", "completed"]) })).max(200);
export function normalizeChat(value: unknown, archived: boolean): CodexChat {
  const raw = object(value);
  const legacy = object(object(object(raw.source).subAgent).thread_spawn);
  return codexChat.parse({
    id: raw.id, title: text(raw.name) ?? text(raw.preview) ?? "Untitled Codex chat",
    cwd: text(raw.cwd, 4000), updatedAt: timestamp(raw.updatedAt), parentId: raw.parentThreadId ?? legacy.parent_thread_id ?? null,
    agentNickname: text(raw.agentNickname ?? legacy.agent_nickname), agentRole: text(raw.agentRole ?? legacy.agent_role), model: text(raw.model),
    status: "unknown", statusSource: "stored", archived,
  });
}
export function normalizeTurn(value: unknown): CodexTurn {
  const raw = object(value); const items = Array.isArray(raw.items) ? raw.items.map(object) : [];
  const user = items.find((i) => i.type === "userMessage");
  const content = user && Array.isArray(user.content) ? user.content.map(object).filter((c) => c.type === "text").map((c) => text(c.text)).filter(Boolean).join("\n") : null;
  const assistant = items.filter((i) => i.type === "agentMessage").at(-1);
  const plan = items.filter((i) => i.type === "plan").at(-1);
  const planText = text(plan?.text, 12_000);
  let tasks: CodexTurn["tasks"] = [];
  if (typeof plan?.text === "string") {
    try {
      const parsed = checklist.safeParse(object(JSON.parse(plan.text)).plan);
      if (parsed.success) tasks = parsed.data.map((step) => ({ text: text(step.step) ?? "Step", status: step.status }));
    } catch {}
  }
  const completed = tasks.filter((step) => step.status === "completed").length;
  return codexTurn.parse({ id: typeof raw.id === "string" ? raw.id : "unknown", status: typeof raw.status === "string" ? raw.status : "unknown",
    startedAt: timestamp(raw.startedAt), completedAt: timestamp(raw.completedAt), request: text(content, 4000), latestMessage: text(assistant?.text, 4000), planText, tasks,
    progress: tasks.length ? { completed, total: tasks.length, percent: Math.round(completed / tasks.length * 100) } : null });
}
