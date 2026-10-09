import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { launch, pair } from "../fixtures/server";
it("persists real HTTP commands, rejects forged acceptance and returns original receipts", async () => {
  let server = await launch();
  try {
    let cookie = await pair(server);
    const call = (
      path: string,
      method = "GET",
      input?: unknown,
      key = randomUUID(),
      reporter = false,
    ) =>
      fetch(server.url + "/api/v1" + path, {
        method,
        headers: {
          ...(reporter
            ? { Authorization: "Bearer " + server.credentials().reporterToken }
            : { Cookie: cookie, Origin: server.url }),
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      });
    const response = await call("/projects", "POST", {
      name: "Synthetic HTTP project",
    });
    expect(response.status).toBe(201);
    const projectId = (await response.json()).data.id;
    const key = randomUUID();
    const input = { projectId, title: "Synthetic task" };
    const created = await call("/tasks", "POST", input, key);
    expect(created.status).toBe(201);
    const receipt = await created.json();
    const id = receipt.data.id;
    expect(
      (
        await call("/tasks/" + id, "PATCH", {
          expectedVersion: 1,
          status: "review",
        })
      ).status,
    ).toBe(200);
    const forged = await call(
      "/tasks/" + id + "/complete",
      "POST",
      { expectedVersion: 2, evidenceNote: "Synthetic test" },
      randomUUID(),
      true,
    );
    expect(forged.status).toBe(403);
    expect(forged.headers.get("AgentFlow-Generation")).toBe(receipt.generation);
    const complete = await call("/tasks/" + id + "/complete", "POST", {
      expectedVersion: 2,
      evidenceNote: "Synthetic browser acceptance fixture",
    });
    expect(complete.status).toBe(201);
    expect(
      (
        await call("/tasks/" + id + "/comments", "POST", {
          text: "immutable comment",
        })
      ).status,
    ).toBe(201);
    expect((await (await call("/tasks/" + id)).json()).data.task).toMatchObject(
      { version: 3, workRevision: 1, status: "completed" },
    );
    const writes = await Promise.all([
      call("/tasks/" + id + "/reopen", "POST", {
        expectedVersion: 3,
        reason: "synthetic A",
      }),
      call("/tasks/" + id + "/reopen", "POST", {
        expectedVersion: 3,
        reason: "synthetic B",
      }),
    ]);
    expect(writes.map((r) => r.status).sort()).toEqual([200, 409]);
    const dir = server.dir;
    await server.stop();
    server = await launch({ dir });
    cookie = await pair(server);
    const retry = await call("/tasks", "POST", input, key);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(receipt);
    const altered = await call(
      "/tasks",
      "POST",
      { ...input, title: " Synthetic task " },
      key,
    );
    expect(altered.status).toBe(409);
    const unknownKey = randomUUID();
    expect(
      (
        await call(
          "/tasks",
          "POST",
          { ...input, actor: "operator" },
          unknownKey,
        )
      ).status,
    ).toBe(422);
    expect((await call("/tasks", "POST", input, unknownKey)).status).toBe(201);
  } finally {
    await server.stop();
  }
}, 60000);
for (const mode of ["before", "after"] as const)
  it(`recovers real HTTP ${mode}-commit process death without duplicate facts`, async () => {
    const { openOwnedStore } = await import("../../src/db");
    const { persistedCounts } = await import("../fixtures/application");
    const key = randomUUID();
    let server = await launch({
      entry: "tests/fixtures/crash-server.ts",
      extraEnv: { AGENTFLOW_TEST_KEY: key, AGENTFLOW_TEST_CRASH: mode },
    });
    try {
      const cookie = await pair(server);
      const headers = {
        Cookie: cookie,
        Origin: server.url,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      };
      const projectResponse = await fetch(server.url + "/api/v1/projects", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Synthetic crash project" }),
      });
      expect(projectResponse.status).toBe(201);
      const projectId = (await projectResponse.json()).data.id;
      const input = { projectId, title: "Synthetic crash task" };
      await expect(
        fetch(server.url + "/api/v1/tasks", {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": key },
          body: JSON.stringify(input),
        }),
      ).rejects.toThrow();
      await server.stop();
      const dir = server.dir;
      const inspected = await openOwnedStore(dir);
      expect(persistedCounts(inspected.instance)).toMatchObject({
        tasks: mode === "before" ? 0 : 1,
        receipts: mode === "before" ? 1 : 2,
        changes: mode === "before" ? 1 : 2,
      });
      inspected.close();
      server = await launch({ dir });
      const renewed = await pair(server);
      const retry = await fetch(server.url + "/api/v1/tasks", {
        method: "POST",
        headers: {
          ...headers,
          Origin: server.url,
          Cookie: renewed,
          "Idempotency-Key": key,
        },
        body: JSON.stringify(input),
      });
      expect(retry.status).toBe(201);
      const body = await retry.json();
      const exact = await fetch(server.url + "/api/v1/tasks", {
        method: "POST",
        headers: {
          ...headers,
          Origin: server.url,
          Cookie: renewed,
          "Idempotency-Key": key,
        },
        body: JSON.stringify(input),
      });
      expect(await exact.json()).toEqual(body);
      await server.stop();
      const final = await openOwnedStore(dir);
      expect(persistedCounts(final.instance)).toMatchObject({
        tasks: 1,
        receipts: 2,
        changes: 2,
      });
      expect(final.store.integrity().integrity).toBe("ok");
      final.close();
    } finally {
      await server.stop();
    }
  }, 60000);
it("authenticates before new-route body failures, keeps generations and shares the mutation budget", async () => {
  const server = await launch();
  try {
    const cookie = await pair(server);
    const generation = (
      await (
        await fetch(server.url + "/api/v1/foundation", {
          headers: { Cookie: cookie },
        })
      ).json()
    ).generation;
    const anonymous = await fetch(server.url + "/api/v1/tasks", {
      method: "POST",
      headers: { "Content-Type": "text/plain", "Content-Length": "70000" },
      body: "x".repeat(70000),
    });
    expect(anonymous.status).toBe(401);
    const oversized = await fetch(server.url + "/api/v1/tasks", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: server.url,
        "Content-Type": "application/json",
      },
      body: "x".repeat(70000),
    });
    expect(oversized.status).toBe(413);
    expect(oversized.headers.get("AgentFlow-Generation")).toBe(generation);
    const wrongType = await fetch(server.url + "/api/v1/tasks", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: server.url,
        "Content-Type": "text/plain",
      },
      body: "{}",
    });
    expect(wrongType.status).toBe(415);
    expect(wrongType.headers.get("AgentFlow-Generation")).toBe(generation);
    const burst: Response[] = [];
    for (let batch = 0; batch < 7; batch++)
      burst.push(
        ...(await Promise.all(
          Array.from({ length: 50 }, (_, i) =>
            fetch(server.url + "/api/v1/tasks", {
              method: "POST",
              headers: {
                ...(i % 2
                  ? {
                      Authorization:
                        "Bearer " + server.credentials().reporterToken,
                    }
                  : { Cookie: cookie, Origin: server.url }),
                "Content-Type": "application/json",
                "Idempotency-Key": randomUUID(),
              },
              body: "{}",
            }),
          ),
        )),
      );
    const limited = burst.filter((r) => r.status === 429);
    expect(limited.length).toBeGreaterThan(0);
    for (const response of limited) {
      expect(response.headers.get("Retry-After")).toBe("1");
      expect(response.headers.get("AgentFlow-Generation")).toBe(generation);
    }
    const read = await fetch(server.url + "/api/v1/projects?limit=50", {
      headers: { Cookie: cookie },
    });
    expect(read.status).toBe(200);
  } finally {
    await server.stop();
  }
}, 60000);
it("keeps list totals and feed cursor together during concurrent HTTP writes and preserves original JSON identity", async () => {
  const server = await launch();
  try {
    const cookie = await pair(server);
    const headers = {
      Cookie: cookie,
      Origin: server.url,
      "Content-Type": "application/json",
    };
    const project = await fetch(server.url + "/api/v1/projects", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ name: "Synthetic snapshot race" }),
    });
    const projectId = (await project.json()).data.id;
    const key = randomUUID();
    const path = server.url + "/api/v1/tasks";
    const first = await fetch(path, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": key },
      body: JSON.stringify({ projectId, title: "identity" }),
    });
    const receipt = await first.json();
    const ordered = await fetch(path, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": key },
      body: '{ "title":"identity", "projectId":"' + projectId + '" }',
    });
    expect(await ordered.json()).toEqual(receipt);
    expect(
      (
        await fetch(path, {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": key },
          body: JSON.stringify({ projectId, title: "identity", tags: [] }),
        })
      ).status,
    ).toBe(409);
    let finished = false;
    const writer = (async () => {
      for (let i = 0; i < 60; i++) {
        const r = await fetch(path, {
          method: "POST",
          headers: { ...headers, "Idempotency-Key": randomUUID() },
          body: JSON.stringify({ projectId, title: "race " + i }),
        });
        expect(r.status).toBe(201);
      }
      finished = true;
    })();
    let samples = 0;
    while (!finished) {
      const r = await fetch(path + "?projectId=" + projectId + "&limit=50", {
        headers: { Cookie: cookie },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(Number(body.snapshotCursor)).toBe(body.data.total + 1);
      expect(body.data.items.length).toBe(Math.min(body.data.total, 50));
      samples++;
    }
    await writer;
    expect(samples).toBeGreaterThan(1);
  } finally {
    await server.stop();
  }
}, 60000);
it('permits reporter JSON mutations with exact allowed Origin and rejects hostile Origin', async () => {
 const server = await launch();
 try {
  const headers={Authorization:'Bearer '+server.credentials().reporterToken,'Content-Type':'application/json','Idempotency-Key':randomUUID()};
  const allowed=await fetch(server.url+'/api/v1/projects',{method:'POST',headers:{...headers,Origin:server.url},body:JSON.stringify({name:'Synthetic allowed-origin reporter'})});
  expect(allowed.status).toBe(201);const body=await allowed.json();expect(allowed.headers.get('AgentFlow-Generation')).toBe(body.generation);
  const originless=await fetch(server.url+'/api/v1/projects',{method:'POST',headers:{...headers,'Idempotency-Key':randomUUID()},body:JSON.stringify({name:'Synthetic originless reporter'})});expect(originless.status).toBe(201);
  const hostile=await fetch(server.url+'/api/v1/projects',{method:'POST',headers:{...headers,Origin:'https://hostile.example'},body:JSON.stringify({name:'must reject'})});expect(hostile.status).toBe(403);expect((await hostile.json()).error.code).toBe('origin_rejected');
  const invalid=await fetch(server.url+'/api/v1/projects',{method:'POST',headers:{...headers,Origin:server.url},body:JSON.stringify({actor:'operator'})});expect(invalid.status).toBe(422);expect(invalid.headers.get('AgentFlow-Generation')).toBe(body.generation);
 }finally{await server.stop();}
},60000);
