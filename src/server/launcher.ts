import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { readConfig, type RuntimeConfig } from "./config";
import { openOwnedStore } from "../db";
import { beginClosing, clearRuntime, publishRuntime } from "./runtime";
import {
  authenticate,
  boundedBody,
  HttpError,
  publicError,
  rejectReadBody,
  validateEnvelope,
} from "./security";

type LifecycleHooks = {
  beforeDispatch?: (request: IncomingMessage) => Promise<void>;
  beforeStoreClose?: () => Promise<void>;
};
export async function startRuntime(
  config: RuntimeConfig,
  hooks: LifecycleHooks = {},
) {
  Object.assign(process.env, {
    NODE_ENV: config.mode,
    NEXT_TELEMETRY_DISABLED: "1",
  });
  const owned = await openOwnedStore(config.dataDir);
  let app: Awaited<ReturnType<(typeof import("next"))["default"]>> | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  const sockets = new Set<Socket>();
  const requests = new Set<Promise<void>>();
  let shutdownPromise: Promise<void> | undefined;
  async function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    beginClosing();
    shutdownPromise = (async () => {
      if (server) {
        const closed = new Promise<void>((resolve) =>
          server!.close(() => resolve()),
        );
        server.closeIdleConnections();
        const timer = setTimeout(() => {
          for (const socket of sockets) socket.destroy();
        }, 1500);
        await closed;
        clearTimeout(timer);
      }
      await Promise.allSettled([...requests]);
      await owned.store.drain();
      await app?.close();
      await hooks.beforeStoreClose?.();
      owned.close();
      clearRuntime();
    })();
    return shutdownPromise;
  }
  try {
    const next = (await import("next")).default;
    app = next({
      dev: config.mode === "development",
      hostname: config.host,
      port: config.port,
    });
    await app.prepare();
    publishRuntime(config, owned);
    const handler = app.getRequestHandler();
    async function dispatch(
      request: IncomingMessage,
      response: import("node:http").ServerResponse,
    ) {
      try {
        if (shutdownPromise) throw new HttpError(503, "unavailable");
        if (
          request.rawHeaders.filter(
            (_, i) =>
              i % 2 === 0 && request.rawHeaders[i].toLowerCase() === "host",
          ).length !== 1
        )
          throw new HttpError(403, "host_rejected");
        validateEnvelope(
          { host: request.headers.host, origin: request.headers.origin },
          config.port,
        );
        rejectReadBody(request);
        response.setHeader("Cache-Control", "no-store");
        const pathname = new URL(
          request.url || "/",
          `http://127.0.0.1:${config.port}`,
        ).pathname;
        if (pathname === "/" || pathname === "/api/v1/foundation") {
          const headers = new Headers();
          for (const [key, value] of Object.entries(request.headers)) {
            if (typeof value === "string") headers.set(key, value);
          }
          authenticate(
            headers,
            owned.store,
            owned.credentials,
            pathname === "/" ? "human" : "read",
          );
          response.setHeader(
            "AgentFlow-Generation",
            owned.store.metadata().generation,
          );
        }
        await hooks.beforeDispatch?.(request);
        if (!["GET", "HEAD"].includes(request.method || "GET")) {
          const body = await boundedBody(request);
          const replay = Readable.from([body]) as IncomingMessage;
          Object.assign(replay, {
            headers: request.headers,
            rawHeaders: request.rawHeaders,
            method: request.method,
            url: request.url,
            httpVersion: request.httpVersion,
            socket: request.socket,
            connection: request.socket,
          });
          await handler(replay, response);
        } else await handler(request, response);
      } catch (error) {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        const failure = publicError(error);
        response.statusCode = failure.status;
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Connection", "close");
        if (failure.status === 503) response.setHeader("Retry-After", "1");
        response.end(
          JSON.stringify({
            error: {
              code: failure.code,
              message:
                "The request could not be completed. Check the local service and request.",
            },
          }),
        );
      }
    }
    server = createServer((request, response) => {
      const pending = dispatch(request, response);
      requests.add(pending);
      void pending.finally(() => requests.delete(pending));
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.headersTimeout = 10000;
    server.requestTimeout = 10000;
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(config.port, config.host, resolve);
    });
    return { shutdown, owned, server };
  } catch (error) {
    await shutdown();
    throw error;
  }
}
async function main() {
  const mode = process.argv.includes("--development")
    ? "development"
    : "production";
  const running = await startRuntime(readConfig(process.env, mode));
  console.log(
    `AgentFlow ready http://127.0.0.1:${running.server.address() && readConfig(process.env, mode).port}`,
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void running.shutdown().then(() => process.exit(0));
    });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(
      error instanceof HttpError
        ? error.code
        : (error as Error).message.split(":")[0],
    );
    process.exitCode = 1;
  });
