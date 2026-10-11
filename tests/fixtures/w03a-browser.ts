import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./server";
export async function githubBrowserFixture() {
  const dir = mkdtempSync(join(tmpdir(), "w03a-ui-"));
  const credential = join(dir, "credential.json");
  writeFileSync(credential, JSON.stringify({ token: "SYNTHETIC_UI_TOKEN" }), { mode: 0o600 });
  const wires: { method: string | undefined; url: string | undefined; version: string | string[] | undefined }[] = [];
  const state = { head: "a".repeat(40), status: 200, draft: false, hold: false };
  let release = () => {};
  let arrived = () => {};
  let arrival = new Promise<void>(resolve => { arrived = resolve; });
  const remote = createServer(async (req, res) => {
    wires.push({ method: req.method, url: req.url, version: req.headers["x-github-api-version"] });
    if (state.hold) { arrived(); await new Promise<void>(resolve => { release = resolve; }); }
    res.statusCode = state.status;
    if (state.status === 429) res.setHeader("Retry-After", "60");
    const item = { number: 9, html_url: "https://github.com/a/b/pull/9", title: "Synthetic private PR", state: "open", draft: state.draft, head: { sha: state.head }, base: { ref: "main" }, merged_at: null };
    res.end(JSON.stringify(state.status === 200 ? req.url?.includes("/pulls/9") ? item : [item] : { message: "DISCARDED_PRIVATE_ERROR" }));
  });
  await new Promise<void>(resolve => remote.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(remote.address() as { port: number }).port}`;
  const server = await launch({ dir: join(dir, "data"), entry: "tests/fixtures/w03a-server.ts", extraEnv: { AGENTFLOW_GITHUB_TOKEN_FILE: credential, W03A_FIXTURE_ORIGIN: origin } });
  return { server, state, wires, credential, dir, arrival: () => arrival, release: () => { state.hold = false; release(); arrival = new Promise<void>(resolve => { arrived = resolve; }); }, async stop() { release(); await server.stop(); await new Promise<void>(resolve => { remote.close(() => resolve()); remote.closeAllConnections(); }); } };
}
