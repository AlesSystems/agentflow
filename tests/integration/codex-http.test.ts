import { expect, it } from "vitest";
import { resolve } from "node:path";
import { launch, pair } from "../fixtures/server";

it("protects Codex history from reporters and exposes source observations to paired browsers", async () => {
  const server = await launch({ extraEnv: { AGENTFLOW_CODEX_EXECUTABLE: resolve("tests/fixtures/codex-observer.mjs") } });
  try {
    const path = "/api/v1/connections/codex";
    expect((await fetch(server.url + path)).status).toBe(401);
    expect((await fetch(server.url + path, {headers:{Authorization:`Bearer ${server.credentials().reporterToken}`}})).status).toBe(403);
    const cookie = await pair(server);
    const headers = {Cookie:cookie};
    const response = await fetch(server.url + path, {headers});
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const list = await response.json();
    expect(list.connection.state).toBe("connected");
    expect(list.data.length).toBeGreaterThan(0);
    expect(list.data[0].statusSource).toBe("stored");
    const detailPath = path + "/" + list.data[0].id;
    expect((await fetch(server.url + detailPath, {headers:{Authorization:`Bearer ${server.credentials().reporterToken}`}})).status).toBe(403);
    const detail = await fetch(server.url + detailPath,{headers});
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body.data.chat.id).toBe(list.data[0].id);
    expect(body.data.turns.length).toBeGreaterThan(0);
    expect(body.data.turns[0].progress).toBeNull();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("raw-secret-command");
    expect((await fetch(server.url + path + "?limit=0",{headers})).status).toBe(400);
    expect((await fetch(server.url + path + "?kind=chats&kind=agents",{headers})).status).toBe(400);
    expect((await fetch(server.url + path,{headers:{...headers,Origin:"http://127.0.0.1:65534"}})).status).toBe(403);
    expect((await fetch(server.url + path,{method:"HEAD",headers})).status).toBe(200);
    expect((await fetch(server.url + "/api/v1/tasks",{headers}).then(r=>r.json())).data.items).toHaveLength(0);
  } finally { await server.stop(); }
}, 60000);
