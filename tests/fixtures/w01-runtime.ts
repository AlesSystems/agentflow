import { chromium } from "@playwright/test";
import { proofErrors } from "./p07-proof-errors";
import { publicProxy } from "./p06-proxy";
import { launch, pair, type OwnedBounds } from "./server";
export const ownedBounds: OwnedBounds = {
  startupMs: 30000,
  healthMs: 1000,
  terminateMs: 3000,
  killMs: 3000,
};
export function boundedLaunch(options: Parameters<typeof launch>[0] = {}) {
  return launch({ ...options, bounds: options.bounds ?? ownedBounds });
}
export function boundedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10000,
) {
  const timeout = AbortSignal.timeout(timeoutMs),
    signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
}
export async function readBoundedText(
  response: Response,
  capture: (text: string) => void = () => {},
) {
  const reader = response.body?.getReader();
  if (!reader) {
    capture("");
    return "";
  }
  const decoder = new TextDecoder("utf8", { fatal: true });
  let text = "";
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      text += decoder.decode(part.value, { stream: true });
      capture(text);
    }
    text += decoder.decode();
    capture(text);
    return text;
  } finally {
    reader.releaseLock();
  }
}

export function boundedProxy(
  server: Parameters<typeof publicProxy>[0],
  decide: Parameters<typeof publicProxy>[1],
  bounds = { httpMs: 10000, closeMs: 5000 },
) {
  return publicProxy(server, decide, bounds);
}

export function boundedPair(server: Awaited<ReturnType<typeof launch>>) {
  return pair(server, boundedFetch);
}

export async function deadline<T>(work: Promise<T>, ms: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
export async function boundedBrowser() {
  const server = await chromium.launchServer({
    channel:
      process.env.AGENTFLOW_TEST_BROWSER === "chrome" ? "chrome" : undefined,
    headless: true,
    timeout: 30000,
  });
  try {
    const browser = await chromium.connect(server.wsEndpoint(), {
      timeout: 30000,
    });
    return {
      browser,
      close: async () => {
        const errors = proofErrors(() => {});
        await errors.attempt("browser disconnect", async () => {
          await deadline(browser.close(), 5000, "OWNED_BROWSER_CLOSE_DEADLINE");
        });
        await errors.attempt("browser server close", async () => {
          await deadline(
            server.close(),
            5000,
            "OWNED_BROWSER_SERVER_CLOSE_DEADLINE",
          );
        });
        if (errors.failed())
          await errors.attempt("browser owned escalation", async () => {
            await deadline(server.kill(), 5000, "OWNED_BROWSER_KILL_DEADLINE");
          });
        errors.throwFirst();
      },
    };
  } catch (primary) {
    await deadline(
      server.kill(),
      5000,
      "OWNED_BROWSER_CONNECT_CLEANUP_DEADLINE",
    ).catch((cleanup) => {
      if (primary instanceof Error)
        Object.assign(primary, { cleanupError: String(cleanup) });
    });
    throw primary;
  }
}
