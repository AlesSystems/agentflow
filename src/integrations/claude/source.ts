import * as nodeFs from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { connectorChat, connectorId, type ConnectorChat } from "../../contracts/connectors";
import { ConnectorObserver, type ConnectorMessages, type ConnectorObserverOptions, type ConnectorSourceReader, type SourceDetail, type SourceIndex } from "../connector/observer";
import { object, text } from "../codex/normalize";
import { buildTurns, deriveIndexFields, parseLines } from "./transcript";

export type ClaudeFs = { open: typeof nodeFs.open; readdir: typeof nodeFs.readdir; stat: typeof nodeFs.stat };
export type ClaudeSourceOptions = { root: string; maxFiles?: number; fs?: ClaudeFs };

const HARD_MAX_FILES = 10_000;
const CHUNK = 256 * 1024;
const DETAIL_BYTES = 16 * 1024 * 1024;
const DETAIL_LINES = 200_000;
const SMALL_JSON = 64 * 1024;
const PAGE = 10;
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
  private paths = new Map<string, string>();
  private closing = false;
  constructor(private readonly options: ClaudeSourceOptions) { this.fs = options.fs ?? nodeFs; }

  private rel(path: string) { return relative(this.options.root, path).split(sep).join("/"); }
  private allowed(path: string, shapes: RegExp[]) { const rel = this.rel(path); return !rel.startsWith("..") && !rel.split("/").includes("..") && shapes.some((re) => re.test(rel)); }
  private async read(path: string, shapes: RegExp[], position: number, length: number): Promise<Buffer> {
    if (this.closing || !this.allowed(path, shapes)) throw sourceError();
    const handle = await this.fs.open(path, "r");
    try {
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
    const add = (entry: Entry) => { if (entries.length >= max) { partial = true; return false; } entries.push(entry); return true; };
    const agents = async (dir: string, parentId: string) => {
      for (const file of await this.list(dir)) {
        const match = file.isFile() && /^agent-(.+)\.jsonl$/.exec(file.name);
        if (!match) continue;
        if (!add({ path: join(dir, file.name), id: match[1], parentId, metaPath: join(dir, `agent-${match[1]}.meta.json`) })) return false;
      }
      return true;
    };
    outer: for (const project of projects) {
      if (!project.isDirectory()) continue;
      const dir = join(root, project.name);
      const children = await this.list(dir);
      for (const child of children) {
        if (child.isFile() && child.name.endsWith(".jsonl")) { if (!add({ path: join(dir, child.name), id: child.name.slice(0, -6), parentId: null, metaPath: null })) break outer; }
        else if (child.isDirectory()) {
          const sub = join(dir, child.name, "subagents");
          if (!(await agents(sub, child.name))) break outer;
          for (const wf of await this.list(join(sub, "workflows"))) if (wf.isDirectory() && wf.name.startsWith("wf_") && !(await agents(join(sub, "workflows", wf.name), child.name))) break outer;
        }
      }
    }
    return { entries, partial };
  }

  private async live(): Promise<Map<string, ChatStatus>> {
    const live = new Map<string, ChatStatus>();
    const dir = join(this.options.root, "sessions");
    for (const file of await this.list(dir)) {
      const match = file.isFile() && /^(\d+)\.json$/.exec(file.name);
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
      return { agentType: text(parsed.agentType), description: text(parsed.description) };
    } catch { return { agentType: null, description: null }; }
  }

  private async derive(entry: Entry, mtimeMs: number, size: number): Promise<ConnectorChat | null> {
    if (!connectorId.safeParse(entry.id).success) return null;
    const head = await this.read(entry.path, transcriptShapes, 0, Math.min(size, size <= 2 * CHUNK ? size : CHUNK));
    const records = parseLines(head.toString("utf8"));
    if (size > 2 * CHUNK) records.push(...parseLines((await this.read(entry.path, transcriptShapes, size - CHUNK, CHUNK)).toString("utf8"), { dropFirst: true }));
    const fields = deriveIndexFields(records);
    const meta = await this.meta(entry.metaPath);
    const agent = entry.parentId !== null;
    return connectorChat.parse({
      id: entry.id, title: fields.customTitle ?? fields.firstRequest ?? (agent ? "Untitled Claude agent" : "Untitled Claude session"),
      cwd: fields.cwd, updatedAt: fields.updatedAt ?? new Date(mtimeMs).toISOString(), parentId: entry.parentId,
      agentNickname: fields.agentName ?? meta.description, agentRole: meta.agentType, model: fields.model,
      status: "unknown", statusSource: "stored", archived: false,
    });
  }

  async loadIndex(): Promise<SourceIndex> {
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
    const size = (await this.fs.stat(path)).size;
    const truncated = size > DETAIL_BYTES;
    const raw = await this.read(path, transcriptShapes, truncated ? size - DETAIL_BYTES : 0, Math.min(size, DETAIL_BYTES));
    const records = parseLines(raw.toString("utf8"), { dropFirst: truncated, maxLines: DETAIL_LINES });
    const fields = deriveIndexFields(records);
    const chat = connectorChat.parse({ ...stored, title: fields.customTitle ?? (truncated ? null : fields.firstRequest) ?? stored.title, cwd: fields.cwd ?? stored.cwd, updatedAt: fields.updatedAt ?? stored.updatedAt, agentNickname: fields.agentName ?? stored.agentNickname, model: fields.model ?? stored.model });
    const turns = buildTurns(records, { running: stored.status === "running" }).reverse();
    const next = offset + PAGE;
    return { chat, turns: turns.slice(offset, next), nextTurnsCursor: next < turns.length ? Buffer.from(JSON.stringify({ offset: next, scope })).toString("base64url") : null };
  }
  beginClosing() { this.closing = true; }
  async close() { this.closing = true; }
}

type ChatStatus = ConnectorChat["status"];
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
export const createClaudeObserver = (options: ClaudeSourceOptions & ConnectorObserverOptions) => new ConnectorObserver(new ClaudeSource(options), options);
