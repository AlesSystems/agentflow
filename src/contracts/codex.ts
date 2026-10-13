import { z } from "zod";

export const codexId = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
const timestamp = z.string().datetime().nullable();
export const codexConnection = z.strictObject({
  state: z.enum(["connected", "unavailable", "stale"]),
  observedAt: timestamp,
  message: z.string().max(1000).nullable(),
});
export const codexChat = z.strictObject({
  id: codexId,
  title: z.string().max(20000),
  cwd: z.string().max(4000).nullable(),
  updatedAt: timestamp,
  parentId: codexId.nullable(),
  agentNickname: z.string().max(1000).nullable(),
  agentRole: z.string().max(1000).nullable(),
  model: z.string().max(1000).nullable(),
  status: z.enum(["running", "waiting", "idle", "unknown"]),
  statusSource: z.enum(["live", "stored"]),
  archived: z.boolean(),
});
export const codexTask = z.strictObject({text: z.string().max(100000), status: z.enum(["pending", "in_progress", "completed"])});
export const codexTurn = z.strictObject({
  id: z.string().max(200), status: z.string().max(100), startedAt: timestamp, completedAt: timestamp,
  request: z.string().max(200000).nullable(), latestMessage: z.string().max(200000).nullable(), planText: z.string().max(200000).nullable(),
  tasks: z.array(codexTask).max(1000),
  progress: z.strictObject({completed: z.number().int().nonnegative(), total: z.number().int().positive(), percent: z.number().min(0).max(100)}).nullable(),
});
export const codexListQuery = z.strictObject({kind: z.enum(["chats", "agents", "all"]).default("chats"), limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().min(1).max(2000).optional(), archived: z.enum(["true", "false"]).default("false"), search: z.string().max(200).optional()});
export const codexDetailQuery = z.strictObject({turnsCursor: z.string().min(1).max(2000).optional(), agentsCursor: z.string().min(1).max(2000).optional()});
export const codexListResponse = z.strictObject({connection: codexConnection, data: z.array(codexChat).max(100), nextCursor: z.string().nullable()});
export const codexDetailResponse = z.strictObject({connection: codexConnection, data: z.strictObject({chat: codexChat, turns: z.array(codexTurn).max(100), agents: z.array(codexChat).max(100), nextTurnsCursor: z.string().nullable(), nextAgentsCursor: z.string().nullable()})});
export type CodexChat = z.infer<typeof codexChat>;
export type CodexTurn = z.infer<typeof codexTurn>;
export type CodexConnection = z.infer<typeof codexConnection>;
export type CodexListQuery = z.infer<typeof codexListQuery>;
export type CodexDetailQuery = z.infer<typeof codexDetailQuery>;
