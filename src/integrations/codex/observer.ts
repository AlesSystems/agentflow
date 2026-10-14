import { z } from "zod";
import { codexListQuery, codexDetailQuery, codexDetailResponse, type CodexChat, type CodexListQuery, type CodexDetailQuery, type CodexConnection } from "../../contracts/codex";
import { normalizeChat, normalizeTurn, object } from "./normalize";
import { CodexRpc, type CodexRpcOptions } from "./rpc";

const sources = ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"];
const page = z.object({ data: z.array(z.unknown()).max(1000), nextCursor: z.string().max(2000).nullable() });
type Detail = z.infer<typeof codexDetailResponse>;
type Index = { chats: CodexChat[]; observedAt: string; partial: boolean };
export type CodexObserverOptions = { executable?: string; args?: string[]; timeoutMs?: number; cacheTtlMs?: number; maxThreads?: number };
const sourceError = () => new Error("Codex source unavailable");
const connection = (index: Index): CodexConnection => ({ state: "connected", observedAt: index.observedAt, message: index.partial ? "Local history exceeds the connector limit. These observations are partial." : "Local stored observations. Desktop live runtime status is unavailable." });

export class CodexObserver {
  private readonly rpc: CodexRpc;
  private index: Index | null = null;
  private loading: Promise<Index> | null = null;
  private closing = false;
  private readonly details = new Map<string, { at: number; value: Detail }>();
  private readonly detailLoads = new Map<string, Promise<Detail>>();
  constructor(private readonly options: CodexObserverOptions = {}) {
    this.rpc = new CodexRpc({ executable: options.executable ?? "codex", args: options.args, timeoutMs: options.timeoutMs } satisfies CodexRpcOptions);
  }
  private async load(): Promise<Index> {
    if (this.closing) throw sourceError();
    if (this.index && Date.now() - Date.parse(this.index.observedAt) < (this.options.cacheTtlMs ?? 5000)) return this.index;
    if (this.loading) return this.loading;
    const loading = (async () => {
      const chats: CodexChat[] = []; let partial = false;
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
      const unique = [...new Map(chats.map((chat) => [chat.id, chat])).values()];
      unique.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.id.localeCompare(b.id));
      const index = { chats: unique, observedAt: new Date().toISOString(), partial };
      this.index = index; return index;
    })();
    this.loading = loading;
    try { return await loading; } finally { if (this.loading === loading) this.loading = null; }
  }
  private offset(cursor: string | undefined, scope: string): number {
    if (!cursor) return 0;
    try {
      const parsed = z.object({ offset: z.number().int().min(0).max(10_000), scope: z.string() }).parse(JSON.parse(Buffer.from(cursor, "base64url").toString()));
      if (parsed.scope !== scope) throw sourceError();
      return parsed.offset;
    } catch { throw sourceError(); }
  }
  private cursor(offset: number, scope: string) { return Buffer.from(JSON.stringify({ offset, scope })).toString("base64url"); }
  private listPage(index: Index, query: CodexListQuery, stale = false) {
    const scope = JSON.stringify([query.archived, query.kind, query.search ?? ""]);
    const filtered = index.chats.filter((chat) => chat.archived === (query.archived === "true") && (query.kind === "all" || (query.kind === "agents" ? chat.parentId !== null : chat.parentId === null)) && (!query.search || chat.title.toLowerCase().includes(query.search.toLowerCase()) || (chat.cwd ?? "").toLowerCase().includes(query.search.toLowerCase())));
    const offset = this.offset(query.cursor, scope);
    return { connection: stale ? { state: "stale" as const, observedAt: index.observedAt, message: "Codex is unavailable. Showing the last successful local observations." } : connection(index), data: filtered.slice(offset, offset + query.limit), nextCursor: offset + query.limit < filtered.length ? this.cursor(offset + query.limit, scope) : null };
  }
  async list(input: CodexListQuery) {
    const query = codexListQuery.parse(input);
    this.offset(query.cursor, JSON.stringify([query.archived, query.kind, query.search ?? ""]));
    try { return this.listPage(await this.load(), query); } catch {
      if (this.index) return this.listPage(this.index, query, true);
      return { connection: { state: "unavailable" as const, observedAt: null, message: "Codex local history is unavailable. Check that Codex is installed and try again." }, data: [], nextCursor: null };
    }
  }
  async detail(id: string, input: CodexDetailQuery = {}): Promise<Detail> {
    const query = codexDetailQuery.parse(input);
    this.offset(query.agentsCursor, "agents:" + id);
    const key = JSON.stringify([id, query]);
    const cached = this.details.get(key);
    if (cached && Date.now() - cached.at < (this.options.cacheTtlMs ?? 5000)) return cached.value;
    const pending = this.detailLoads.get(key);
    if (pending) return pending;
    if (this.detailLoads.size >= 4) throw sourceError();
    const loading = this.readDetail(id, query).then((value) => {
      if (this.details.size >= 32) this.details.delete(this.details.keys().next().value!);
      this.details.set(key, { at: Date.now(), value });
      return value;
    }).catch(() => {
      if (cached) return { ...cached.value, connection: { state: "stale" as const, observedAt: cached.value.connection.observedAt, message: "Codex is unavailable. Showing the last successful local observations." } };
      throw sourceError();
    }).finally(() => { this.detailLoads.delete(key); });
    this.detailLoads.set(key, loading);
    return loading;
  }
  private async readDetail(id: string, query: CodexDetailQuery): Promise<Detail> {
    try {
      const index = await this.load();
      const stored = index.chats.find((chat) => chat.id === id);
      if (!stored) throw sourceError();
      const rawChat = object(await this.rpc.request("thread/read", { threadId: id, includeTurns: false }));
      const chat = normalizeChat(rawChat.thread, stored.archived);
      const result = page.parse(await this.rpc.request("thread/turns/list", { threadId: id, cursor: query.turnsCursor, limit: 10, sortDirection: "desc", itemsView: "summary" }));
      const turns = result.data.map(normalizeTurn);
      if (turns.length && !query.turnsCursor) {
        const entries = page.parse(await this.rpc.request("thread/items/list", { threadId: id, turnId: turns[0].id, limit: 100, sortDirection: "desc" }));
        const raw = object(result.data[0]);
        const earliest = page.parse(await this.rpc.request("thread/items/list", { threadId: id, turnId: turns[0].id, limit: 10, sortDirection: "asc" }));
        const request = normalizeTurn({ ...raw, items: earliest.data.map((entry) => object(entry).item) }).request;
        const recent = normalizeTurn({ ...raw, items: entries.data.map((entry) => object(entry).item).reverse() });
        turns[0] = { ...recent, request: request ?? recent.request ?? turns[0].request, planText: recent.planText ?? turns[0].planText };
      }
      const agents = index.chats.filter((candidate) => candidate.parentId === id);
      const scope = "agents:" + id; const offset = this.offset(query.agentsCursor, scope);
      return { connection: { ...connection(index), message: "Local stored observations. Turn activity is a bounded recent window; desktop live runtime status is unavailable." }, data: { chat, turns, agents: agents.slice(offset, offset + 30), nextTurnsCursor: result.nextCursor, nextAgentsCursor: offset + 30 < agents.length ? this.cursor(offset + 30, scope) : null } };
    } catch { throw sourceError(); }
  }
  beginClosing() { this.closing = true; this.rpc.beginClosing(); }
  close() { this.beginClosing(); return this.rpc.close(); }
}
