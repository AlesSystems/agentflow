import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { openOwnedStore,migrations } from "../../src/db";
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
  const originalOwned=await openOwnedStore(dir,migrations.slice(0,2));originalOwned.close();
  let db = new Database(join(dir,"agentflow.sqlite"));
  let owned:Awaited<ReturnType<typeof openOwnedStore>>|undefined;
  let unregister:(()=>void)|undefined;
  const { ApplicationData: Base } = await import(/* @vite-ignore */ pathToFileURL(join(source,"src/db/application.ts")).href);
  const baseline = new Base(db,dir);
  try {
    const send = (command: ApplicationCommand) =>
      baseline.command(command, {
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
    const agentId=randomUUID(),runId=randomUUID();
    db.prepare("INSERT INTO agents(id,display_name,source,default_role,version,created_at) VALUES(?,?,?,?,?,?)").run(agentId,"Synthetic","fixture","implementation",1,1000);
    db.prepare("INSERT INTO runs(id,project_id,agent_id,task_id,purpose,model,work_revision,state,last_sequence,last_received_at,started_at,ended_at,version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(runId,projectId,agentId,taskId,"implementation",null,1,"queued",0,1000,null,null,1,1000);
    const query: ApplicationQuery = {
      kind: "task",
      id: taskId,
      input: { history: "both", historyLimit: 50 },
    };
    const baseReply=baseline.snapshot(query,1000);db.close();owned=await openOwnedStore(dir);unregister=owned.instance.registerConnection();db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});const headReply=new ApplicationData(db,dir).snapshot(query,1000);
    expect(baseReply.body.data.latestRun).not.toHaveProperty("registrationOrder");
    expect(
      (headReply.body.data as { latestRun: unknown }).latestRun,
    ).not.toHaveProperty("registrationOrder");
    expect(baseReply.body.data).not.toEqual(headReply.body.data);
    expect(comparableSnapshot(query,{...baseReply.body,data:{...baseReply.body.data,latestRun:{...baseReply.body.data.latestRun,registrationOrder:1}}})).toEqual(comparableSnapshot(query,baseReply.body));
    expect(comparableSnapshot(query, baseReply.body)).toEqual(
      comparableSnapshot(query, headReply.body),
    );
    expect(baseReply.body.data.latestRun).not.toHaveProperty("registrationOrder");
    expect(() =>
      comparableSnapshot(query, {
        ...baseReply.body,
        data: { ...baseReply.body.data, unrecognizedPublicField: true },
      }),
    ).toThrow();
  } finally {
    db.close();
    unregister?.();
    owned?.close();
    rmSync(source, { recursive: true });
  }
});
