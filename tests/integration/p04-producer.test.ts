import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launch } from "../fixtures/server";
it("runs an external producer subprocess through production public HTTP and checks independent SQLite counts", async () => {
  const server = await launch();
  try {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "tests/fixtures/p04-producer.ts"],
      {
        env: {
          ...process.env,
          AGENTFLOW_PRODUCER_URL: server.url,
          AGENTFLOW_PRODUCER_TOKEN: server.credentials().reporterToken,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "",
      errors = "";
    child.stdout.on("data", (v) => (output += v));
    child.stderr.on("data", (v) => (errors += v));
    const exit = await new Promise<number | null>((resolve) =>
      child.on("exit", resolve),
    );
    expect(exit, errors).toBe(0);
    const artifact = JSON.parse(output);
    expect(artifact.records.map((r: { status: number }) => r.status)).toEqual([
      201, 201, 201, 201, 201, 201, 201, 201, 200, 422, 409, 200, 201, 201, 201,
      200,
    ]);
    const db = new Database(join(server.dir, "agentflow.sqlite"), {
      readonly: true,
    });
    try {
      const counts = Object.fromEntries(
        [
          "projects",
          "tasks",
          "agents",
          "runs",
          "run_registrations",
          "run_events",
          "run_closures",
          "receipts",
          "changes",
        ].map((t) => [
          t,
          (db.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n,
        ]),
      );
      expect(counts).toEqual({
        projects: 1,
        tasks: 1,
        agents: 1,
        runs: 2,
        run_registrations: 2,
        run_events: 6,
        run_closures: 0,
        receipts: 5,
        changes: 21,
      });
      expect(
        db.prepare("SELECT status,version,work_revision FROM tasks").get(),
      ).toEqual({ status: "review", version: 5, work_revision: 2 });
      if (process.env.AGENTFLOW_P04_EVIDENCE_DIR)
        writeFileSync(
          join(process.env.AGENTFLOW_P04_EVIDENCE_DIR, "producer.json"),
          JSON.stringify(
            {
              ...artifact,
              exitCode: exit,
              counts,
              task: db
                .prepare("SELECT status,version,work_revision FROM tasks")
                .get(),
            },
            null,
            2,
          ) + "\n",
        );
    } finally {
      db.close();
    }
  } finally {
    await server.stop();
  }
});
