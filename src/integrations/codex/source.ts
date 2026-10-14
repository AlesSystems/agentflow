import { z } from "zod";
import type { ConnectorChat } from "../../contracts/connectors";
import { ConnectorObserver, type ConnectorMessages, type ConnectorSourceReader, type SourceDetail, type SourceIndex } from "../connector/observer";
import { normalizeChat, normalizeTurn, object } from "./normalize";
import { CodexRpc, type CodexRpcOptions } from "./rpc";

const sources = ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"];
const page = z.object({ data: z.array(z.unknown()).max(1000), nextCursor: z.string().max(2000).nullable() });
export type CodexObserverOptions = { executable?: string; args?: string[]; timeoutMs?: number; cacheTtlMs?: number; maxThreads?: number };
const sourceError = () => new Error("Codex source unavailable");

export class CodexSource implements ConnectorSourceReader {
  readonly messages: ConnectorMessages = {
    connected: "Local stored observations. Desktop live runtime status is unavailable.",
    partial: "Local history exceeds the connector limit. These observations are partial.",
    detail: "Local stored observations. Turn activity is a bounded recent window; desktop live runtime status is unavailable.",
    stale: "Codex is unavailable. Showing the last successful local observations.",
    unavailable: "Codex local history is unavailable. Check that Codex is installed and try again.",
  };
  private readonly rpc: CodexRpc;
  constructor(private readonly options: CodexObserverOptions = {}) {
    this.rpc = new CodexRpc({ executable: options.executable ?? "codex", args: options.args, timeoutMs: options.timeoutMs } satisfies CodexRpcOptions);
  }
  async loadIndex(): Promise<SourceIndex> {
    const chats: ConnectorChat[] = []; let partial = false;
    const deadline = Date.now() + 30_000;
    const maxThreads = Math.min(this.options.maxThreads ?? 10_000, 10_000);
    for (const archived of [false, true]) {
      let cursor: string | null = null; const seen = new Set<string>(); let pages = 0;
      do {
        if (Date.now() > deadline || ++pages > 100) throw sourceError();
        const result = page.parse(await this.rpc.request("thread/list", { limit: 100, cursor, archived, sourceKinds: sources, useStateDbOnly: true, sortKey: "updated_at" }));
        for (const raw of result.data) {
          if (chats.length >= maxThreads) { partial = true; break; }
          chats.push(normalizeChat(raw, archived));
        }
        cursor = result.nextCursor;
        if (cursor && seen.has(cursor)) throw sourceError();
        if (cursor) seen.add(cursor);
        if (chats.length >= maxThreads) { partial = partial || !!cursor || archived === false; break; }
      } while (cursor);
      if (partial) break;
    }
    return { chats, partial };
  }
  async readDetail(stored: ConnectorChat, turnsCursor: string | undefined): Promise<SourceDetail> {
    const id = stored.id;
    const rawChat = object(await this.rpc.request("thread/read", { threadId: id, includeTurns: false }));
    const chat = normalizeChat(rawChat.thread, stored.archived);
    const result = page.parse(await this.rpc.request("thread/turns/list", { threadId: id, cursor: turnsCursor, limit: 10, sortDirection: "desc", itemsView: "summary" }));
    const turns = result.data.map(normalizeTurn);
    if (turns.length && !turnsCursor) {
      const entries = page.parse(await this.rpc.request("thread/items/list", { threadId: id, turnId: turns[0].id, limit: 100, sortDirection: "desc" }));
      const raw = object(result.data[0]);
      const earliest = page.parse(await this.rpc.request("thread/items/list", { threadId: id, turnId: turns[0].id, limit: 10, sortDirection: "asc" }));
      const request = normalizeTurn({ ...raw, items: earliest.data.map((entry) => object(entry).item) }).request;
      const recent = normalizeTurn({ ...raw, items: entries.data.map((entry) => object(entry).item).reverse() });
      turns[0] = { ...recent, request: request ?? recent.request ?? turns[0].request, planText: recent.planText ?? turns[0].planText };
    }
    return { chat, turns, nextTurnsCursor: result.nextCursor };
  }
  beginClosing() { this.rpc.beginClosing(); }
  close() { return this.rpc.close(); }
}
export const createCodexObserver = (options: CodexObserverOptions) => new ConnectorObserver(new CodexSource(options), options);
