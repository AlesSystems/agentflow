import type { IncomingMessage, ServerResponse } from "node:http";
import type { Store } from "../db";
import type { Credentials } from "./auth";
import { authenticate, HttpError } from "./security";
import { parseStreamRequest } from "../contracts/stream";

type Lease = { close: () => void; bytes: () => number; blocked: () => boolean; resources: () => { timers: number; listeners: number } };
export class ChangeStreams {
  private closing = false;
  private observations = { writes: 0, lastWriteAt: 0, invalidAt: 0, pressureAt: 0, peakBytes: 0, stalledCloses: 0 };
  private leases = new Set<Lease>();
  constructor(private readonly store: Store, private readonly credentials: Credentials) {}
  diagnostics() {
    return { ...this.observations, leases: this.leases.size, bytes: [...this.leases].reduce((n, l) => n + l.bytes(), 0), blocked: [...this.leases].filter((l) => l.blocked()).length, timers: [...this.leases].reduce((n, l) => n + l.resources().timers, 0), listeners: [...this.leases].reduce((n, l) => n + l.resources().listeners, 0) };
  }
  close() {
    this.closing = true;
    for (const lease of [...this.leases]) lease.close();
  }
  async serve(request: IncomingMessage, response: ServerResponse, headers: Headers, url: URL) {
    if (this.closing) throw new HttpError(503, "unavailable");
    let input: ReturnType<typeof parseStreamRequest>;
    try {
      const ids: string[] = [];
      for (let i = 0; i < request.rawHeaders.length; i += 2)
        if (request.rawHeaders[i].toLowerCase() === "last-event-id") ids.push(request.rawHeaders[i + 1]);
      input = parseStreamRequest(url, ids);
    } catch { throw new HttpError(400, "query_invalid"); }
    const initial = this.store.changeBatch(input.after);
    response.setHeader("AgentFlow-Generation", initial.generation);
    if (request.method === "HEAD") { response.statusCode = 200; response.end(); return; }
    if (this.leases.size >= 20) throw new HttpError(429, "stream_limit");
    let cursor = input.after;
    let ended = false;
    let blocked = false;
    let queue: Buffer[] = [];
    let queuedBytes = 0;
    let poll: NodeJS.Timeout | undefined;
    let stall: NodeJS.Timeout | undefined;
    let resolve!: () => void;
    const done = new Promise<void>((value) => { resolve = value; });
    const valid = () => {
      try {
        authenticate(headers, this.store, this.credentials, "human");
        return true;
      } catch { this.observations.invalidAt = performance.now(); close(); return false; }
    };
    const lease: Lease = { close: () => close(), bytes: () => queuedBytes + response.writableLength, blocked: () => blocked, resources: () => ({ timers: 2 + Number(!!poll) + Number(!!stall), listeners: 3 }) };
    const auth = setInterval(valid, 500);
    const keepalive = setInterval(() => {
      if (!ended && !blocked && valid()) write(Buffer.from(": keepalive\n\n"));
    }, 15000);
    function close(destroy = true) {
      if (ended) return;
      ended = true;
      clearTimeout(poll); clearTimeout(stall); clearInterval(auth); clearInterval(keepalive);
      response.off("drain", drain); response.off("close", onClose); request.off("aborted", onClose);
      queue = []; queuedBytes = 0;
      leases.delete(lease);
      if (destroy) response.destroy();
      resolve();
    }
    function onClose() { close(); }
    const leases = this.leases;
    const write = (frame: Buffer) => {
      if (ended || !valid()) return false;
      if (queuedBytes + response.writableLength + frame.length > 1048576) { close(); return false; }
      this.observations.writes++;
      this.observations.lastWriteAt = performance.now();
      const writable = response.write(frame);
      this.observations.peakBytes = Math.max(this.observations.peakBytes, queuedBytes + response.writableLength);
      if (!writable) {
        blocked = true;
        this.observations.pressureAt = performance.now();
        stall = setTimeout(() => { this.observations.stalledCloses++; close(); }, 5000);
      }
      return writable;
    };
    const flush = () => {
      while (!ended && !blocked && queue.length) {
        const frame = queue.shift()!;
        queuedBytes -= frame.length;
        write(frame);
      }
      if (!ended && !blocked && !poll) poll = setTimeout(pump, queue.length ? 0 : 500);
    };
    function drain() {
      if (ended || !valid()) return;
      clearTimeout(stall); stall = undefined; blocked = false;
      flush();
    }
    const pump = () => {
      poll = undefined;
      if (ended || blocked || !valid()) return;
      try {
        const batch = this.store.changeBatch(cursor);
        if (batch.generation !== input.generation || BigInt(cursor) > BigInt(batch.maximum)) {
          const reason = batch.generation !== input.generation ? "generation_changed" : "cursor_ahead";
          write(Buffer.from(`event: reset\ndata: ${JSON.stringify({ reason, generation: batch.generation })}\n\n`));
          // Reset contains no private records; end only this finite response.
          if (!ended) { response.end(); close(false); }
          return;
        }
        for (const change of batch.changes) {
          const frame = Buffer.from(`id: ${change.id}\nevent: change\ndata: ${JSON.stringify(change.data)}\n\n`);
          if (queuedBytes + response.writableLength + frame.length > 1048576) { close(); return; }
          queue.push(frame); queuedBytes += frame.length;
          cursor = change.id;
        }
        flush();
        if (!ended && !blocked && batch.changes.length === 100) {
          clearTimeout(poll); poll = setTimeout(pump, 0);
        }
      } catch { close(); }
    };
    this.leases.add(lease);
    response.on("drain", drain); response.on("close", onClose); request.on("aborted", onClose);
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();
    pump();
    await done;
  }
}
