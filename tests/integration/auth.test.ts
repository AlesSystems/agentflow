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
it("rejects a genuinely expired persisted session through production HTTP", async () => {
  const cookie = await pair(server);
  const { hashSecret } = await import("../../src/server/auth");
  const Database = (await import("better-sqlite3")).default;
  const { join } = await import("node:path");
  const fixture = new Database(join(server.dir, "agentflow.sqlite"));
  fixture
    .prepare("UPDATE sessions SET expires_at=? WHERE secret_hash=?")
    .run(Date.now() - 1, hashSecret(cookie.slice(cookie.indexOf("=") + 1)));
  fixture.close();
  for (const path of ["/api/v1/foundation", "/"])
    expect(
      (await fetch(server.url + path, { headers: { Cookie: cookie } })).status,
    ).toBe(401);
});
it("GET and HEAD enforce body framing and byte limits before private dispatch", async () => {
  const { request } = await import("node:http");
  async function read(
    method: string,
    headers: Record<string, string>,
    body?: string,
  ) {
    return new Promise<number>((resolve, reject) => {
      const req = request(
        server.url + "/api/v1/foundation",
        {
          method,
          headers: {
            Authorization: "Bearer " + server.credentials().reporterToken,
            ...headers,
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  }
  for (const method of ["GET", "HEAD"]) {
    expect(
      await read(method, { "Content-Length": "65537" }, "x".repeat(65537)),
    ).toBe(413);
    expect(
      await read(method, { "Transfer-Encoding": "chunked" }, "x".repeat(65537)),
    ).toBe(400);
    expect(await read(method, { "Content-Length": "1" }, "x")).toBe(400);
    expect(await read(method, { "Content-Length": "0" })).toBe(200);
    expect(await read(method, {})).toBe(200);
  }
});
it('authenticated session failures carry generation while invalid credentials do not',async()=>{
 const cookie=await pair(server);const current=(await(await fetch(server.url+'/api/v1/foundation',{headers:{Cookie:cookie}})).json()).generation;
 const headers={Cookie:cookie,Origin:server.url,'Content-Type':'application/json'};
 for(const [body,status] of [['{',400],['{"extra":true}',422]] as const){const response=await fetch(server.url+'/api/v1/session',{method:'DELETE',headers,body});expect(response.status).toBe(status);expect(response.headers.get('AgentFlow-Generation')).toBe(current);expect(response.headers.get('Cache-Control')).toBe('no-store');}
 const rejected=await fetch(server.url+'/api/v1/session',{method:'DELETE',headers:{Origin:server.url,'Content-Type':'application/json',Authorization:'Bearer '+server.credentials().reporterToken},body:'{}'});expect(rejected.status).toBe(403);expect(rejected.headers.get('AgentFlow-Generation')).toBe(current);
 for(const Cookie of ['', 'agentflow_session=invalid']){const response=await fetch(server.url+'/api/v1/session',{method:'DELETE',headers:{Cookie,Origin:server.url,'Content-Type':'application/json'},body:'{}'});expect(response.status).toBe(401);expect(response.headers.get('AgentFlow-Generation')).toBeNull();}
 const Database=(await import('better-sqlite3')).default;const {join}=await import('node:path');const {hashSecret}=await import('../../src/server/auth');const fixture=new Database(join(server.dir,'agentflow.sqlite'));fixture.prepare('UPDATE sessions SET expires_at=? WHERE secret_hash=?').run(Date.now()-1,hashSecret(cookie.slice(cookie.indexOf('=')+1)));fixture.close();const expired=await fetch(server.url+'/api/v1/session',{method:'DELETE',headers,body:'{}'});expect(expired.status).toBe(401);expect(expired.headers.get('AgentFlow-Generation')).toBeNull();
});
