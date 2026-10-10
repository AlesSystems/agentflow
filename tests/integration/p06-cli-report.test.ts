import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { launch } from "../fixtures/server";
import { cliFixture } from "../fixtures/p06-cli";
it("durably preserves the original observation offline then a fresh CLI flushes it exactly once", async () => {
  let server = await launch();
  const fixture = cliFixture(server);
  const register = async (name: string[], body: unknown) => {
    const result = await fixture.cli([...name,"--file",fixture.file(body),"--idempotency-key",randomUUID()]);
    expect(result.code).toBe(0); return JSON.parse(result.stdout).id as string;
  };
  try {
    const projectId = await register(["project","create"],{name:"Synthetic"});
    const agentId = await register(["agent","register"],{displayName:"Synthetic",source:"fixture",defaultRole:"implementation"});
    const runId = await register(["run","register"],{id:randomUUID(),projectId,agentId,purpose:"planning"});
    await server.stop();
    const result = await fixture.cli(["report","--run",runId,"--type","run.started","--payload",fixture.file({})]);
    expect(result.code).toBe(2);
    const directory = join(fixture.env.AGENTFLOW_OUTBOX_DIR,runId);
    const file = readdirSync(directory).find(name => /^1-/.test(name))!;
    const original = JSON.parse(readFileSync(join(directory,file),"utf8"));
    expect(original).toMatchObject({body:{runId,sequence:1,type:"run.started",schemaVersion:1,payload:{}}});
    server = await launch({dir:server.dir,port:server.port});
    const flushed = await fixture.cli(["flush","--run",runId]);
    expect(flushed.code).toBe(0);
    expect(Object.keys(JSON.parse(flushed.stdout)).sort()).toEqual(["acceptedSequence","eventId","generation","receivedAt","runId"]);
    expect((await fixture.cli(["flush","--run",runId])).code).toBe(0);
    const db = new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});
    try { expect(db.prepare("SELECT count(*) n FROM run_events").get()).toEqual({n:1}); expect(db.prepare("SELECT event_id FROM run_events").get()).toEqual({event_id:original.body.eventId}); } finally {db.close();}
    expect(JSON.parse(readFileSync(join(directory,"state.json"),"utf8"))).toMatchObject({allocatedThrough:1,acknowledgedThrough:1});
    expect(readdirSync(directory)).toEqual(["state.json"]);
  } finally {await server.stop();}
});
