import { expect, it } from "vitest";
import { join } from "node:path";
import { launch, pair } from "../fixtures/server";
import { createClaudeHome, sentinels, secretToken } from "../fixtures/claude-home";

it("protects Claude sessions from reporters and exposes transcript observations to paired browsers", async () => {
  const home = createClaudeHome();
  const server = await launch({ extraEnv: { AGENTFLOW_CLAUDE_DIR: home.root } });
  try {
    const path = "/api/v1/connections/claude";
    expect((await fetch(server.url + path)).status).toBe(401);
    const reporter = { Authorization: `Bearer ${server.credentials().reporterToken}` };
    expect((await fetch(server.url + path, { headers: reporter })).status).toBe(403);
    const headers = { Cookie: await pair(server) };
    const response = await fetch(server.url + path + "?kind=all", { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const list = await response.json();
    expect(list.connection.state).toBe("connected");
    const byId = Object.fromEntries(list.data.map((c: { id: string }) => [c.id, c]));
    expect(Object.keys(byId).sort()).toEqual(["ag1", "ag2", "sess-a", "sess-b"]);
    expect(byId["sess-a"]).toMatchObject({ status: "running", statusSource: "live" });
    const agents = await (await fetch(server.url + path + "?kind=agents", { headers })).json();
    expect(agents.data.map((c: { id: string }) => c.id).sort()).toEqual(["ag1", "ag2"]);
    expect(agents.data.every((c: { parentId: string }) => c.parentId === "sess-a")).toBe(true);
    const detailPath = path + "/sess-a";
    expect((await fetch(server.url + detailPath, { headers: reporter })).status).toBe(403);
    const detail = await fetch(server.url + detailPath, { headers });
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body.data.chat.id).toBe("sess-a");
    expect(body.data.turns.length).toBeGreaterThan(0);
    expect(body.data.turns.some((t: { progress: { total: number } | null }) => t.progress && t.progress.total > 0)).toBe(true);
    expect(body.data.agents.map((c: { id: string }) => c.id).sort()).toEqual(["ag1", "ag2"]);
    const serialized = JSON.stringify([list, agents, body]);
    for (const text of [sentinels.thinking, sentinels.toolResult, sentinels.history, sentinels.key, sentinels.settings, sentinels.toolInput, secretToken])
      expect(serialized).not.toContain(text);
    expect((await fetch(server.url + path + "?limit=0", { headers })).status).toBe(400);
    expect((await fetch(server.url + path + "?kind=chats&kind=agents", { headers })).status).toBe(400);
    expect((await fetch(server.url + path, { headers: { ...headers, Origin: "http://127.0.0.1:65534" } })).status).toBe(403);
    expect((await fetch(server.url + path, { method: "HEAD", headers })).status).toBe(200);
    expect((await fetch(server.url + "/api/v1/tasks", { headers }).then((r) => r.json())).data.items).toHaveLength(0);
  } finally { await server.stop(); home.cleanup(); }
}, 60000);

it("reports an unavailable connection when the Claude directory is missing", async () => {
  const server = await launch({ extraEnv: { AGENTFLOW_CLAUDE_DIR: join("/nonexistent-agentflow-claude", "home") } });
  try {
    const headers = { Cookie: await pair(server) };
    const response = await fetch(server.url + "/api/v1/connections/claude", { headers });
    expect(response.status).toBe(200);
    expect((await response.json()).connection.state).toBe("unavailable");
  } finally { await server.stop(); }
}, 60000);
