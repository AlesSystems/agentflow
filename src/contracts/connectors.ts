import { z } from "zod";

export const connectorId = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
const timestamp = z.string().datetime().nullable();
export const connectorConnection = z.strictObject({
  state: z.enum(["connected", "unavailable", "stale"]),
  observedAt: timestamp,
  message: z.string().max(1000).nullable(),
});
export const connectorChat = z.strictObject({
  id: connectorId,
  title: z.string().max(20000),
  cwd: z.string().max(4000).nullable(),
  updatedAt: timestamp,
  parentId: connectorId.nullable(),
  agentNickname: z.string().max(1000).nullable(),
  agentRole: z.string().max(1000).nullable(),
  model: z.string().max(1000).nullable(),
  status: z.enum(["running", "waiting", "idle", "unknown"]),
  statusSource: z.enum(["live", "stored"]),
  archived: z.boolean(),
});
export const connectorTask = z.strictObject({text: z.string().max(100000), status: z.enum(["pending", "in_progress", "completed"])});
export const connectorTurn = z.strictObject({
  id: z.string().max(200), status: z.string().max(100), startedAt: timestamp, completedAt: timestamp,
  request: z.string().max(200000).nullable(), latestMessage: z.string().max(200000).nullable(), planText: z.string().max(200000).nullable(),
  tasks: z.array(connectorTask).max(1000),
  progress: z.strictObject({completed: z.number().int().nonnegative(), total: z.number().int().positive(), percent: z.number().min(0).max(100)}).nullable(),
});
export const connectorListQuery = z.strictObject({kind: z.enum(["chats", "agents", "all"]).default("chats"), limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().min(1).max(2000).optional(), archived: z.enum(["true", "false"]).default("false"), search: z.string().max(200).optional()});
export const connectorDetailQuery = z.strictObject({turnsCursor: z.string().min(1).max(2000).optional(), agentsCursor: z.string().min(1).max(2000).optional()});
export const connectorListResponse = z.strictObject({connection: connectorConnection, data: z.array(connectorChat).max(100), nextCursor: z.string().nullable()});
export const connectorDetailResponse = z.strictObject({connection: connectorConnection, data: z.strictObject({chat: connectorChat, turns: z.array(connectorTurn).max(100), agents: z.array(connectorChat).max(100), nextTurnsCursor: z.string().nullable(), nextAgentsCursor: z.string().nullable()})});
export type ConnectorChat = z.infer<typeof connectorChat>;
export type ConnectorTurn = z.infer<typeof connectorTurn>;
export type ConnectorConnection = z.infer<typeof connectorConnection>;
export type ConnectorListQuery = z.infer<typeof connectorListQuery>;
export type ConnectorDetailQuery = z.infer<typeof connectorDetailQuery>;
export const connectorSource = z.enum(["codex", "claude"]);
export type ConnectorSource = z.infer<typeof connectorSource>;
