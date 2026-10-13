import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const methods = new Set(["initialize", "thread/list", "thread/read", "thread/turns/list", "thread/items/list"]);
export type CodexReadMethod = "thread/list" | "thread/read" | "thread/turns/list" | "thread/items/list";
export type CodexRpcOptions = { executable: string; args?: string[]; timeoutMs?: number; maxFrameBytes?: number };
const unavailable = () => new Error("Codex source unavailable");

export class CodexRpc {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private initialization: Promise<void> | null = null;
  private closing = false;
  private windowStartedAt = Date.now();
  private windowBytes = 0;
  private windowFrames = 0;
  private readonly exits = new Set<Promise<void>>();
  constructor(private readonly options: CodexRpcOptions) {}
  private fail() {
    const child = this.child;
    this.child = null;
    this.initialization = null;
    this.buffer = Buffer.alloc(0);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(unavailable()); }
    this.pending.clear();
    if (child) {
      child.stdin.destroy();
      child.kill("SIGTERM");
      const kill = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 1000);
      kill.unref();
      child.once("exit", () => clearTimeout(kill));
    }
  }
  private async ready() {
    if (this.closing) throw unavailable();
    if (this.initialization) return this.initialization;
    const child = spawn(this.options.executable, this.options.args ?? ["app-server", "--stdio"], { stdio: "pipe", shell: false });
    this.child = child;
    const exited = new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.once("error", () => resolve()); });
    this.exits.add(exited);
    void exited.then(() => this.exits.delete(exited));
    child.stderr.resume();
    child.once("error", () => { if (this.child === child) this.fail(); });
    child.once("exit", () => { if (this.child === child) this.fail(); });
    child.stdin.on("error", () => { if (this.child === child) this.fail(); });
    child.stdout.on("data", (chunk: Buffer) => {
      if (this.child !== child) return;
      if (Date.now() - this.windowStartedAt > 5000) { this.windowStartedAt = Date.now(); this.windowBytes = 0; this.windowFrames = 0; }
      this.windowBytes += chunk.length;
      if (this.windowBytes > 32 * 1024 * 1024) { this.fail(); return; }
      this.buffer = Buffer.concat([this.buffer, chunk]);
      const max = this.options.maxFrameBytes ?? 8 * 1024 * 1024;
      while (this.buffer.length) {
        const newline = this.buffer.indexOf(10);
        if (newline < 0) { if (this.buffer.length > max) this.fail(); return; }
        if (newline > max) { this.fail(); return; }
        const line = this.buffer.subarray(0, newline);
        this.buffer = this.buffer.subarray(newline + 1);
        if (++this.windowFrames > 4096) { this.fail(); return; }
        if (!line.length) continue;
        let message: Record<string, unknown>;
        try { message = JSON.parse(line.toString("utf8")); } catch { this.fail(); return; }
        if (!message || typeof message !== "object" || Array.isArray(message)) { this.fail(); return; }
        if (typeof message.method === "string") {
          if (typeof message.id === "number" || typeof message.id === "string") child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: "Read-only observer" } }) + "\n");
          continue;
        }
        const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
        if (!pending) continue;
        clearTimeout(pending.timer); this.pending.delete(message.id as number);
        if (Object.hasOwn(message, "error")) pending.reject(unavailable());
        else if (Object.hasOwn(message, "result")) pending.resolve(message.result);
        else { pending.reject(unavailable()); this.fail(); return; }
      }
    });
    const promise = this.send("initialize", { clientInfo: { name: "agentflow_observer", version: "1.0.0" }, capabilities: { experimentalApi: true, requestAttestation: false } }).then(() => {
      if (this.child !== child || this.closing) throw unavailable();
      child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    });
    this.initialization = promise;
    try { await promise; } catch { if (this.child === child) this.fail(); throw unavailable(); }
  }
  private send(method: string, params: unknown): Promise<unknown> {
    if (!this.child || this.closing || this.pending.size >= 8) return Promise.reject(unavailable());
    const child = this.child; const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.child === child) this.fail(); }, this.options.timeoutMs ?? 10_000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n", (error) => { if (error && this.child === child) this.fail(); });
    });
  }
  async request(method: CodexReadMethod, params: unknown): Promise<unknown> {
    if (!methods.has(method) || method === ("initialize" as string)) throw new Error("unsupported Codex method");
    await this.ready();
    return this.send(method, params);
  }
  beginClosing() { this.closing = true; this.fail(); }
  async close() { this.beginClosing(); await Promise.all([...this.exits]); }
}
