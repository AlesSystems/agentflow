import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { openOwnedStore } from "../../src/db";
import {
  ApplicationData,
  type ApplicationCommand,
  type ApplicationQuery,
} from "../../src/db/application";
import { canonicalDigest } from "../../src/domain/request-digest";
import { comparableSnapshot } from "../performance/public-projection";
it("compares the unchanged extracted baseline against only its validated public task-detail projection", async () => {
  const source = mkdtempSync(
    join(realpathSync(tmpdir()), "agentflow-p04-base-source-"),
  );
  const dir = mkdtempSync(
    join(realpathSync(tmpdir()), "agentflow-p04-helper-"),
  );
  const archive = execFileSync("git", [
    "archive",
    "ced1c1be7dd9d170fc6139b77578f4159c9ebf80",
    "src",
  ]);
  execFileSync("tar", ["-xf", "-", "-C", source], { input: archive });
  symlinkSync(
    join(process.cwd(), "node_modules"),
    join(source, "node_modules"),
  );
  const owned = await openOwnedStore(dir);
  const unregister = owned.instance.registerConnection();
  const db = new Database(join(dir, "agentflow.sqlite"), { readonly: true });
  try {
    const send = (command: ApplicationCommand) =>
      owned.store.command(command, {
        principal: "operator",
        method: "POST",
        path: command.kind,
        key: randomUUID(),
        digest: canonicalDigest(command.input),
        now: 1000,
      });
    const projectId = (
      send({ kind: "project.create", input: { name: "Synthetic baseline" } })
        .body.data as { id: string }
    ).id;
    const taskId = (
      send({ kind: "task.create", input: { projectId, title: "Synthetic" } })
        .body.data as { id: string }
    ).id;
    const agentId = (
      send({
        kind: "agent.create",
        input: {
          displayName: "Synthetic",
          source: "fixture",
          defaultRole: "implementation",
        },
      }).body.data as { id: string }
    ).id;
    send({
      kind: "run.register",
      input: {
        id: randomUUID(),
        projectId,
        agentId,
        taskId,
        purpose: "implementation",
        expectedTaskVersion: 1,
      },
    });
    const { ApplicationData: Base } = await import(
      /* @vite-ignore */ pathToFileURL(join(source, "src/db/application.ts"))
        .href
    );
    const baseline = new Base(db, dir);
    const head = new ApplicationData(db, dir);
    const query: ApplicationQuery = {
      kind: "task",
      id: taskId,
      input: { history: "both", historyLimit: 50 },
    };
    const baseReply = baseline.snapshot(query, 1000),
      headReply = head.snapshot(query, 1000);
    expect(baseReply.body.data.latestRun.registrationOrder).toBe(1);
    expect(
      (headReply.body.data as { latestRun: unknown }).latestRun,
    ).not.toHaveProperty("registrationOrder");
    expect(baseReply.body.data).not.toEqual(headReply.body.data);
    expect(comparableSnapshot(query, baseReply.body)).toEqual(
      comparableSnapshot(query, headReply.body),
    );
    expect(baseReply.body.data.latestRun.registrationOrder).toBe(1);
    expect(() =>
      comparableSnapshot(query, {
        ...baseReply.body,
        data: { ...baseReply.body.data, unrecognizedPublicField: true },
      }),
    ).toThrow();
  } finally {
    db.close();
    unregister();
    owned.close();
    rmSync(source, { recursive: true });
  }
});
