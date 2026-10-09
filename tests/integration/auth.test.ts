import { afterAll, beforeAll, expect, it } from "vitest";
import { launch, pair } from "../fixtures/server";
let server: Awaited<ReturnType<typeof launch>>;
beforeAll(async () => {
  server = await launch();
});
afterAll(async () => {
  await server?.stop();
});
it("pairs, persists a hashed session and revokes browser access", async () => {
  const cookie = await pair(server);
  const response = await fetch(server.url + "/api/v1/foundation", {
    headers: { Cookie: cookie },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("AgentFlow-Generation")).toBeTruthy();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(
    (
      await fetch(server.url + "/api/v1/session", {
        method: "DELETE",
        headers: {
          Cookie: cookie,
          Origin: server.url,
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
  ).toBe(204);
  expect(
    (
      await fetch(server.url + "/api/v1/foundation", {
        headers: { Cookie: cookie },
      })
    ).status,
  ).toBe(401);
});
it("keeps pairing and reporter authority separate", async () => {
  const creds = server.credentials();
  expect(creds.pairingToken).not.toBe(creds.reporterToken);
  expect(
    (
      await fetch(server.url + "/api/v1/foundation", {
        headers: { Authorization: "Bearer " + creds.reporterToken },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await fetch(server.url + "/api/v1/foundation", {
        headers: { Authorization: "Bearer " + creds.pairingToken },
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await fetch(server.url + "/api/v1/session", {
        method: "POST",
        headers: { Origin: server.url, "Content-Type": "application/json" },
        body: JSON.stringify({ token: creds.reporterToken }),
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await fetch(server.url + "/api/v1/session", {
        method: "DELETE",
        headers: {
          Origin: server.url,
          "Content-Type": "application/json",
          Authorization: "Bearer " + creds.reporterToken,
        },
        body: "{}",
      })
    ).status,
  ).toBe(403);
});
it("rejects unauthenticated reads, cross-origin, same-site, malformed and oversized bodies", async () => {
  expect((await fetch(server.url + "/api/v1/foundation")).status).toBe(401);
  const cookie = await pair(server);
  for (const headers of [
    { "Sec-Fetch-Site": "same-site" },
    { "Sec-Fetch-Site": "cross-site" },
    { Origin: "http://localhost:9876" },
  ] as Record<string, string>[])
    expect(
      (
        await fetch(server.url + "/api/v1/foundation", {
          headers: { Cookie: cookie, ...headers },
        })
      ).status,
    ).toBe(403);
  expect(
    (
      await fetch(server.url + "/api/v1/foundation", {
        headers: {
          Cookie: cookie,
          Authorization: "Bearer " + server.credentials().reporterToken,
        },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(server.url + "/api/v1/session", {
        method: "POST",
        headers: { Origin: server.url, "Content-Type": "application/json" },
        body: "{",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await fetch(server.url + "/api/v1/session", {
        method: "POST",
        headers: { Origin: server.url, "Content-Type": "text/plain" },
        body: "{}",
      })
    ).status,
  ).toBe(415);
  expect(
    (
      await fetch(server.url + "/api/v1/session", {
        method: "POST",
        headers: { Origin: server.url, "Content-Type": "application/json" },
        body: JSON.stringify({
          token: server.credentials().pairingToken,
          extra: true,
        }),
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await fetch(server.url + "/api/v1/session", {
        method: "POST",
        headers: { Origin: server.url, "Content-Type": "application/json" },
        body: "x".repeat(65537),
      })
    ).status,
  ).toBe(413);
});
it("bounded chunked bodies and SQL contention return safe errors", async () => {
  const { request } = await import("node:http");
  const oversized = await new Promise<number>((resolve) => {
    const req = request(
      server.url + "/api/v1/session",
      {
        method: "POST",
        headers: {
          Origin: server.url,
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode!);
      },
    );
    req.on("error", () => {});
    req.write("x".repeat(32768));
    req.end("x".repeat(32769));
  });
  expect(oversized).toBe(413);
  const Database = (await import("better-sqlite3")).default;
  const { join } = await import("node:path");
  const contender = new Database(join(server.dir, "agentflow.sqlite"));
  contender.exec("BEGIN IMMEDIATE");
  try {
    const response = await fetch(server.url + "/api/v1/session", {
      method: "POST",
      headers: { Origin: server.url, "Content-Type": "application/json" },
      body: JSON.stringify({ token: server.credentials().pairingToken }),
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect((await response.json()).error.code).toBe("database_busy");
  } finally {
    contender.exec("ROLLBACK");
    contender.close();
  }
});
it("same-site page and RSC/prefetch GET requests are forbidden", async () => {
  const cookie = await pair(server);
  for (const path of ["/", "/?_rsc=synthetic"]) {
    const response = await fetch(server.url + path, {
      headers: {
        Cookie: cookie,
        "Sec-Fetch-Site": "same-site",
        RSC: "1",
        "Next-Router-Prefetch": "1",
      },
    });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("generation");
  }
});
