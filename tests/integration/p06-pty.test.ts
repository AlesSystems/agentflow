import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { ptyCli } from "../fixtures/p06-pty";
it("captures real PTY exits 0, 2, 1, and 3 with credential and file arguments absent from output", async () => {
  let server = await launch();
  const f = await registeredRun(server);
  const records: { code: number; output: string; tty: boolean }[] = [];
  try {
    records.push(await ptyCli(["report", "--run", f.runId, "--type", "run.started", "--payload", f.file({})], f.env));
    const { dir, port } = server;
    await server.stop();
    records.push(await ptyCli(["report", "--run", f.runId, "--type", "run.heartbeat", "--payload", f.file({})], f.env));
    records.push(await ptyCli(["not-a-command", "--file", f.file({ private: "PTY_PRIVATE_TEXT" })], f.env));
    server = await launch({ dir, port });
    expect((await f.cli(["flush"])).code).toBe(0);
    expect((await f.cli(["report", "--run", f.runId, "--type", "run.succeeded", "--payload", f.file({ summary: "PTY_PRIVATE_SUMMARY" })])).code).toBe(0);
    records.push(await ptyCli(["report", "--run", f.runId, "--type", "run.heartbeat", "--payload", f.file({})], f.env));
    expect(records.map(r => r.code)).toEqual([0,2,1,3]);
    for (const record of records) {
      expect(record.tty).toBe(true);
      for (const sentinel of [server.credentials().reporterToken, f.dir, "PTY_PRIVATE_TEXT", "PTY_PRIVATE_SUMMARY", "--payload", "--file"]) expect(record.output).not.toContain(sentinel);
    }
    expect(records[1].output).toContain('"code":"queued"');
    expect(records[2].output).toContain('"code":"invalid_command"');
    expect(records[3].output).toContain('"code":"run_terminal"');
    if (process.env.AGENTFLOW_P06_EVIDENCE_DIR) writeFileSync(join(process.env.AGENTFLOW_P06_EVIDENCE_DIR, "pty.json"), JSON.stringify({ records, invocation: "direct Node, no npm argument banner", owned: [server.dir, f.dir] }, null, 2) + "\n", { mode: 0o600 });
  } finally { await server.stop(); }
}, 45000);
