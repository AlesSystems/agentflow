import { z } from "zod";
import { connectorListQuery, connectorDetailQuery, connectorDetailResponse, type ConnectorChat, type ConnectorTurn, type ConnectorListQuery, type ConnectorDetailQuery, type ConnectorConnection } from "../../contracts/connectors";

export type SourceIndex = { chats: ConnectorChat[]; partial: boolean };
export type SourceDetail = { chat: ConnectorChat; turns: ConnectorTurn[]; nextTurnsCursor: string | null };
export type ConnectorMessages = { connected: string; partial: string; detail: string; stale: string; unavailable: string };
export interface ConnectorSourceReader {
  readonly messages: ConnectorMessages;
  loadIndex(): Promise<SourceIndex>;
  readDetail(stored: ConnectorChat, turnsCursor: string | undefined): Promise<SourceDetail>;
  beginClosing(): void;
  close(): Promise<void>;
}
export type ConnectorObserverOptions = { cacheTtlMs?: number };
type Detail = z.infer<typeof connectorDetailResponse>;
type Index = SourceIndex & { observedAt: string };
const sourceError = () => new Error("Connector source unavailable");

export class ConnectorObserver {
  private index: Index | null = null;
  private loading: Promise<Index> | null = null;
  private closing = false;
  private readonly details = new Map<string, { at: number; value: Detail }>();
  private readonly detailLoads = new Map<string, Promise<Detail>>();
  constructor(private readonly source: ConnectorSourceReader, private readonly options: ConnectorObserverOptions = {}) {}
  private connection(index: Index): ConnectorConnection { return { state: "connected", observedAt: index.observedAt, message: index.partial ? this.source.messages.partial : this.source.messages.connected }; }
  private async load(): Promise<Index> {
    if (this.closing) throw sourceError();
    if (this.index && Date.now() - Date.parse(this.index.observedAt) < (this.options.cacheTtlMs ?? 5000)) return this.index;
    if (this.loading) return this.loading;
    const loading = (async () => {
      const { chats, partial } = await this.source.loadIndex();
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
  private listPage(index: Index, query: ConnectorListQuery, stale = false) {
    const scope = JSON.stringify([query.archived, query.kind, query.search ?? ""]);
    const filtered = index.chats.filter((chat) => chat.archived === (query.archived === "true") && (query.kind === "all" || (query.kind === "agents" ? chat.parentId !== null : chat.parentId === null)) && (!query.search || chat.title.toLowerCase().includes(query.search.toLowerCase()) || (chat.cwd ?? "").toLowerCase().includes(query.search.toLowerCase())));
    const offset = this.offset(query.cursor, scope);
    return { connection: stale ? { state: "stale" as const, observedAt: index.observedAt, message: this.source.messages.stale } : this.connection(index), data: filtered.slice(offset, offset + query.limit), nextCursor: offset + query.limit < filtered.length ? this.cursor(offset + query.limit, scope) : null };
  }
  async list(input: ConnectorListQuery) {
    const query = connectorListQuery.parse(input);
    this.offset(query.cursor, JSON.stringify([query.archived, query.kind, query.search ?? ""]));
    try { return this.listPage(await this.load(), query); } catch {
      if (this.index) return this.listPage(this.index, query, true);
      return { connection: { state: "unavailable" as const, observedAt: null, message: this.source.messages.unavailable }, data: [], nextCursor: null };
    }
  }
  async detail(id: string, input: ConnectorDetailQuery = {}): Promise<Detail> {
    const query = connectorDetailQuery.parse(input);
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
      if (cached) return { ...cached.value, connection: { state: "stale" as const, observedAt: cached.value.connection.observedAt, message: this.source.messages.stale } };
      throw sourceError();
    }).finally(() => { this.detailLoads.delete(key); });
    this.detailLoads.set(key, loading);
    return loading;
  }
  private async readDetail(id: string, query: ConnectorDetailQuery): Promise<Detail> {
    try {
      const index = await this.load();
      const stored = index.chats.find((chat) => chat.id === id);
      if (!stored) throw sourceError();
      const { chat, turns, nextTurnsCursor } = await this.source.readDetail(stored, query.turnsCursor);
      const agents = index.chats.filter((candidate) => candidate.parentId === id);
      const scope = "agents:" + id; const offset = this.offset(query.agentsCursor, scope);
      return { connection: { ...this.connection(index), message: this.source.messages.detail }, data: { chat, turns, agents: agents.slice(offset, offset + 30), nextTurnsCursor, nextAgentsCursor: offset + 30 < agents.length ? this.cursor(offset + 30, scope) : null } };
    } catch { throw sourceError(); }
  }
  beginClosing() { this.closing = true; this.source.beginClosing(); }
  close() { this.beginClosing(); return this.source.close(); }
}
