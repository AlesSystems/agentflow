import { createServer, type IncomingMessage } from "node:http";
import type { launch } from "./server";
import { freePort } from "./server";
import { failureFact } from "./p07-warm-error";
type Decision =
  | { drop: true }
  | {
      status: number;
      body: string;
      headers?: Record<string, string>;
      truncate?: boolean;
    };
type Reply = { status: number; body: Buffer; generation: string | null; retryAfter:string|null };
export async function publicProxy(
  server: Pick<Awaited<ReturnType<typeof launch>>, "url">,
  decide: (
    request: IncomingMessage,
    body: Buffer,
    reply?: Reply,
  ) => Promise<Decision | undefined> | Decision | undefined,
  bounds?: { httpMs: number; closeMs: number },
) {
  const port = await freePort(),
    controllers = new Set<AbortController>(),
    pending = new Set<Promise<void>>();
  const failures: {
    path: string;
    status: number | null;
    generation: string | null;
    bodyBase64: string;
    error: ReturnType<typeof failureFact>;
  }[] = [];
  const proxy = createServer((req, res) => {
    const work = (async () => {
      const controller = bounds ? new AbortController() : undefined;
      if (controller) controllers.add(controller);
      const timer = bounds
        ? setTimeout(() => {
            controller!.abort(new Error("OWNED_PROXY_HTTP_DEADLINE"));
            req.destroy();
            res.destroy();
          }, bounds.httpMs)
        : undefined;
      let reply: Reply | undefined;
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        function finish(result: Decision) {
          if ("drop" in result) {
            res.destroy();
            return;
          }
          res.writeHead(result.status, result.headers);
          if (result.truncate) {
            res.write(result.body);
            res.socket?.end();
          } else res.end(result.body);
        }
        const before = await decide(req, body);
        if (before) {
          finish(before);
          return;
        }
        const headers: Record<string, string> = {};
        for (const name of [
          "authorization",
          "content-type",
          "idempotency-key",
          "prefer",
        ]) {
          const value = req.headers[name];
          if (typeof value === "string") headers[name] = value;
        }
        const response = await fetch(server.url + req.url, {
          method: req.method,
          headers,
          body: req.method === "POST" ? body : undefined,
          redirect: "manual",
          signal: controller?.signal,
        });
        reply = {
          status: response.status,
          body: Buffer.alloc(0),
          generation: response.headers.get("agentflow-generation"),
          retryAfter: response.headers.get("retry-after"),
        };
        if (bounds && response.body) {
          const reader = response.body.getReader(),
            parts: Buffer[] = [];
          try {
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              parts.push(Buffer.from(part.value));
              reply.body = Buffer.concat(parts);
            }
          } finally {
            reader.releaseLock();
          }
        } else reply.body = Buffer.from(await response.arrayBuffer());
        const after = await decide(req, body, reply);
        if (after) {
          finish(after);
          return;
        }
        const forwarded = Object.fromEntries(
          [...response.headers].filter(
            ([name]) =>
              ![
                "content-encoding",
                "content-length",
                "transfer-encoding",
                "connection",
                "keep-alive",
              ].includes(name),
          ),
        );
        res.writeHead(response.status, forwarded);
        res.end(reply.body);
      } catch (error) {
        failures.push({
          path: req.url ?? "",
          status: reply?.status ?? null,
          generation: reply?.generation ?? null,
          bodyBase64: reply?.body.toString("base64") ?? "",
          error: failureFact(error),
        });
        res.destroy();
      } finally {
        clearTimeout(timer);
        if (controller) controllers.delete(controller);
      }
    })();
    pending.add(work);
    void work.finally(() => pending.delete(work));
  });
  await new Promise<void>((resolve) =>
    proxy.listen(port, "127.0.0.1", resolve),
  );
  return {
    port,
    failures,
    inFlight: () => pending.size,
    close: async () => {
      const stopped = new Promise<void>((resolve) =>
        proxy.close(() => resolve()),
      );
      if (!bounds) {
        await stopped;
        return;
      }
      for (const controller of controllers)
        controller.abort(new Error("OWNED_PROXY_CLOSING"));
      proxy.closeAllConnections();
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all([stopped, Promise.allSettled([...pending])]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("OWNED_PROXY_CLOSE_DEADLINE")),
            bounds.closeMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
    },
  };
}
