import { constants as fsConstants } from "node:fs";
import * as nodeFs from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { connectorChat, connectorId, type ConnectorChat, type ConnectorTurn } from "../../contracts/connectors";
import { ConnectorObserver, type ConnectorMessages, type ConnectorObserverOptions, type ConnectorSourceReader, type SourceDetail, type SourceIndex } from "../connector/observer";
import { object, text } from "../codex/normalize";
import { buildTurns, deriveIndexFields, parseLines } from "./transcript";

export type ClaudeFs = { open: typeof nodeFs.open; readdir: typeof nodeFs.readdir; stat: typeof nodeFs.stat; realpath: typeof nodeFs.realpath };
export type ClaudeSourceOptions = { root: string; maxFiles?: number; fs?: ClaudeFs };

const HARD_MAX_FILES = 10_000;
const CHUNK = 256 * 1024;
const DETAIL_BYTES = 16 * 1024 * 1024;
const DETAIL_LINES = 200_000;
const SMALL_JSON = 64 * 1024;
const PAGE = 10;
const LARGE = 512 * 1024;
const MAX_TAIL = 2 * 1024 * 1024;
const MAX_DETAIL_CACHE = 8;
const sourceError = () => new Error("Claude source unavailable");

// The only path shapes (relative to the root) this reader may ever open.
const transcriptShapes = [
  /^projects\/[^/]+\/[^/]+\.jsonl$/,
  /^projects\/[^/]+\/[^/]+\/subagents\/agent-[^/]+\.jsonl$/,
  /^projects\/[^/]+\/[^/]+\/subagents\/workflows\/wf_[^/]+\/agent-[^/]+\.jsonl$/,
];
const metaShapes = [
  /^projects\/[^/]+\/[^/]+\/subagents\/agent-[^/]+\.meta\.json$/,
  /^projects\/[^/]+\/[^/]+\/subagents\/workflows\/wf_[^/]+\/agent-[^/]+\.meta\.json$/,
];
const sessionShape = /^sessions\/\d+\.json$/;

type Entry = { path: string; id: string; parentId: string | null; metaPath: string | null };
type DetailCached = { mtimeMs: number; size: number; truncated: boolean; fields: ReturnType<typeof deriveIndexFields>; turns: ConnectorTurn[] };
type Cached = { mtimeMs: number; size: number; chat: ConnectorChat };

export class ClaudeSource implements ConnectorSourceReader {
  readonly messages: ConnectorMessages = {
    connected: "Local Claude Code transcripts. Running status comes from live Claude Code processes.",
    partial: "Local Claude Code history exceeds the connector limit. These observations are partial.",
    detail: "Local Claude Code transcript. Turn activity is a bounded recent window; checklist progress is shown only where Claude recorded a task list.",
    stale: "Claude Code history is unavailable. Showing the last successful local observations.",
    unavailable: "Claude Code local history is unavailable. Check that Claude Code has run on this machine and try again.",
  };
  private readonly fs: ClaudeFs;
  private readonly cache = new Map<string, Cached>();
  private readonly detailCache = new Map<string, DetailCached>();
  private rootReal: Promise<string> | null = null;
  private paths = new Map<string, string>();
  private closing = false;
  constructor(private readonly options: ClaudeSourceOptions) { this.fs = options.fs ?? nodeFs; }

  private rel(path: string) { return relative(this.options.root, path).split(sep).join("/"); }
  private allowed(path: string, shapes: RegExp[]) { const rel = this.rel(path); return !rel.startsWith("..") && !rel.split("/").includes("..") && shapes.some((re) => re.test(rel)); }
  private async read(path: string, shapes: RegExp[], position: number, length: number): Promise<Buffer> {
    if (this.closing || !this.allowed(path, shapes)) throw sourceError();
    const rootReal = await (this.rootReal ??= this.fs.realpath(this.options.root));
    const parent = await this.fs.realpath(dirname(path));
    if (parent !== rootReal && !parent.startsWith(rootReal + sep)) throw sourceError();
    const handle = await this.fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
    try {
      if (!(await handle.stat()).isFile()) throw sourceError();
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      return buffer.subarray(0, bytesRead);
    } finally { await handle.close(); }
  }
  private async list(path: string) {
    try { return await this.fs.readdir(path, { withFileTypes: true }); } catch { return []; }
  }

  private async walk(max: number): Promise<{ entries: Entry[]; partial: boolean }> {
    const root = join(this.options.root, "projects");
    const projects = await this.fs.readdir(root, { withFileTypes: true });
    const entries: Entry[] = []; let partial = false;
    // Entries are in readdir order, so when the cap is hit the kept subset is arbitrary, not newest-first.
    const add = (entry: Entry) => { if (entries.length >= max) { partial = true; return false; } entries.push(entry); return true; };
    const agents = async (dir: string, parentId: string) => {
      for (const file of await this.list(dir)) {
        const match = !file.isSymbolicLink() && file.isFile() && /^agent-(.+)\.jsonl$/.exec(file.name);
        if (!match) continue;
        if (!add({ path: join(dir, file.name), id: match[1], parentId, metaPath: join(dir, `agent-${match[1]}.meta.json`) })) return false;
      }
      return true;
    };
    outer: for (const project of projects) {
      if (project.isSymbolicLink() || !project.isDirectory()) continue;
      const dir = join(root, project.name);
      const children = await this.list(dir);
      for (const child of children) {
        if (!child.isSymbolicLink() && child.isFile() && child.name.endsWith(".jsonl")) { if (!add({ path: join(dir, child.name), id: child.name.slice(0, -6), parentId: null, metaPath: null })) break outer; }
        else if (!child.isSymbolicLink() && child.isDirectory()) {
          const sub = join(dir, child.name, "subagents");
          if (!(await this.list(join(dir, child.name))).some((e) => e.name === "subagents" && !e.isSymbolicLink() && e.isDirectory())) continue;
          if (!(await agents(sub, child.name))) break outer;
          const subEntries = await this.list(sub);
          if (!subEntries.some((e) => e.name === "workflows" && !e.isSymbolicLink() && e.isDirectory())) continue;
          for (const wf of await this.list(join(sub, "workflows"))) if (!wf.isSymbolicLink() && wf.isDirectory() && wf.name.startsWith("wf_") && !(await agents(join(sub, "workflows", wf.name), child.name))) break outer;
        }
      }
    }
    return { entries, partial };
  }

  private async live(): Promise<Map<string, ChatStatus>> {
    const live = new Map<string, ChatStatus>();
    const dir = join(this.options.root, "sessions");
    for (const file of await this.list(dir)) {
      const match = !file.isSymbolicLink() && file.isFile() && /^(\d+)\.json$/.exec(file.name);
      if (!match) continue;
      try {
        const pid = Number(match[1]);
        if (!Number.isSafeInteger(pid) || pid <= 0 || !alive(pid)) continue;
        const parsed = object(JSON.parse((await this.read(join(dir, file.name), [sessionShape], 0, SMALL_JSON)).toString("utf8")));
        if (typeof parsed.sessionId !== "string") continue;
        const status: ChatStatus = parsed.status === "busy" ? "running" : parsed.status === "idle" ? "idle" : "unknown";
        if (live.get(parsed.sessionId) !== "running") live.set(parsed.sessionId, status);
      } catch { /* ignore unreadable or malformed process file */ }
    }
    return live;
  }

  private async meta(path: string | null) {
    if (!path) return { agentType: null, description: null };
    try {
      const parsed = object(JSON.parse((await this.read(path, metaShapes, 0, SMALL_JSON)).toString("utf8")));
      return { agentType: text(parsed.agentType, 1000), description: text(parsed.description, 1000) };
    } catch { return { agentType: null, description: null }; }
  }

  private async derive(entry: Entry, mtimeMs: number, size: number): Promise<ConnectorChat | null> {
    if (!connectorId.safeParse(entry.id).success) return null;
    const head = await this.read(entry.path, transcriptShapes, 0, Math.min(size, size <= 2 * CHUNK ? size : CHUNK));
    const records = parseLines(head.toString("utf8"));
    if (size > 2 * CHUNK) {
      // Extend the tail window backwards until at least one complete record parses.
      for (let length = CHUNK; ; length += CHUNK) {
        const window = Math.min(length, size);
        const tail = parseLines((await this.read(entry.path, transcriptShapes, size - window, window)).toString("utf8"), { dropFirst: window < size });
        if (tail.length || length >= MAX_TAIL || window >= size) { records.push(...tail); break; }
      }
    }
    const fields = deriveIndexFields(records);
    const meta = await this.meta(entry.metaPath);
    const agent = entry.parentId !== null;
    return connectorChat.parse({
      id: entry.id, title: fields.customTitle ?? fields.firstRequest ?? (agent ? "Untitled Claude agent" : "Untitled Claude session"),
      cwd: fields.cwd, updatedAt: updatedAt(fields.updatedAt, mtimeMs, size), parentId: entry.parentId,
      agentNickname: fields.agentName ?? meta.description, agentRole: meta.agentType, model: fields.model,
      status: "unknown", statusSource: "stored", archived: false,
    });
  }

  async loadIndex(): Promise<SourceIndex> {
    this.rootReal = null;
    const { entries, partial } = await this.walk(Math.min(this.options.maxFiles ?? HARD_MAX_FILES, HARD_MAX_FILES));
    const live = await this.live();
    const seen = new Set<string>(); const paths = new Map<string, string>(); const chats: ConnectorChat[] = [];
    for (const entry of entries) {
      try {
        const stat = await this.fs.stat(entry.path);
        let cached = this.cache.get(entry.path);
        if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
          const chat = await this.derive(entry, stat.mtimeMs, stat.size);
          if (!chat) continue;
          cached = { mtimeMs: stat.mtimeMs, size: stat.size, chat };
          this.cache.set(entry.path, cached);
        }
        seen.add(entry.path); paths.set(cached.chat.id, entry.path);
        const status = entry.parentId === null ? live.get(entry.id) : undefined;
        chats.push(status ? { ...cached.chat, status, statusSource: "live" } : cached.chat);
      } catch { /* skip unreadable file */ }
    }
    for (const path of this.cache.keys()) if (!seen.has(path)) this.cache.delete(path);
    this.paths = paths;
    return { chats, partial };
  }

  async readDetail(stored: ConnectorChat, turnsCursor: string | undefined): Promise<SourceDetail> {
    if (this.closing) throw sourceError();
    const scope = `turns:${stored.id}`;
    let offset = 0;
    if (turnsCursor) {
      try {
        const parsed = object(JSON.parse(Buffer.from(turnsCursor, "base64url").toString()));
        if (parsed.scope !== scope || typeof parsed.offset !== "number" || !Number.isInteger(parsed.offset) || parsed.offset < 0 || parsed.offset > 10_000) throw sourceError();
        offset = parsed.offset;
      } catch { throw sourceError(); }
    }
    const path = this.paths.get(stored.id);
    if (!path) throw sourceError();
    const stat = await this.fs.stat(path);
    let cached = this.detailCache.get(path);
    if (cached && (cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size)) cached = undefined;
    if (cached) { this.detailCache.delete(path); this.detailCache.set(path, cached); }
    else {
      const size = stat.size;
      const truncated = size > DETAIL_BYTES;
      const raw = await this.read(path, transcriptShapes, truncated ? size - DETAIL_BYTES : 0, Math.min(size, DETAIL_BYTES));
      const records = parseLines(raw.toString("utf8"), { dropFirst: truncated, maxLines: DETAIL_LINES });
      cached = { mtimeMs: stat.mtimeMs, size, truncated, fields: deriveIndexFields(records), turns: buildTurns(records, { running: false }) };
      this.detailCache.set(path, cached);
      while (this.detailCache.size > MAX_DETAIL_CACHE) this.detailCache.delete(this.detailCache.keys().next().value!);
    }
    const { fields, truncated } = cached;
    const chat = connectorChat.parse({ ...stored, title: fields.customTitle ?? (truncated ? null : fields.firstRequest) ?? stored.title, cwd: truncated ? stored.cwd : fields.cwd ?? stored.cwd, updatedAt: updatedAt(fields.updatedAt, cached.mtimeMs, cached.size), agentNickname: fields.agentName ?? stored.agentNickname, model: fields.model ?? stored.model });
    const built = cached.turns.map((turn, i, all) => stored.status === "running" && i === all.length - 1 ? { ...turn, status: "inProgress" as const, completedAt: null } : turn);
    const turns = built.reverse();
    const next = offset + PAGE;
    return { chat, turns: turns.slice(offset, next), nextTurnsCursor: next < turns.length ? Buffer.from(JSON.stringify({ offset: next, scope })).toString("base64url") : null };
  }
  beginClosing() { this.closing = true; }
  async close() { this.closing = true; }
}

// For large files only the tail is read, so the file mtime bounds staleness from below.
function updatedAt(last: string | null, mtimeMs: number, size: number): string {
  const mtime = new Date(mtimeMs).toISOString();
  return last === null || (size > LARGE && mtime > last) ? mtime : last;
}
type ChatStatus = ConnectorChat["status"];
function alive(pid: number): boolean {
  // EPERM means the pid now belongs to another user (Claude runs as us), so not alive. Same-user pid reuse is a known limit.
  try { process.kill(pid, 0); return true; } catch { return false; }
}
export const createClaudeObserver = (options: ClaudeSourceOptions & ConnectorObserverOptions) => new ConnectorObserver(new ClaudeSource(options), options);
