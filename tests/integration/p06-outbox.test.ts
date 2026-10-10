import { join } from "node:path";
import { readFileSync, readdirSync, unlinkSync, writeFileSync, chmodSync } from "node:fs";
import { expect, it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { openOutbox } from "../../src/cli/outbox";
import { createFile, syncDirectory } from "../../src/server/filesystem";
import { renameSync } from "node:fs";

it("allocates concurrent durable observations contiguously and refuses a missing highest allocated sequence", async () => {
  const server = await launch();
  const fixture = await registeredRun(server);
  await server.stop();
  const args = ["report","--run",fixture.runId,"--type","run.started","--payload",fixture.file({})];
  const results = await Promise.all(Array.from({length:6},()=>fixture.cli(args)));
  expect(results.every(result=>result.code===2)).toBe(true);
  const directory = join(fixture.env.AGENTFLOW_OUTBOX_DIR,fixture.runId);
  const files = readdirSync(directory).filter(name=>/^\d+-/.test(name));
  const events = files.map(name=>JSON.parse(readFileSync(join(directory,name),"utf8")).body);
  expect(events.map(e=>e.sequence).sort((a,b)=>a-b)).toEqual([1,2,3,4,5,6]);
  expect(new Set(events.map(e=>e.eventId)).size).toBe(6);
  expect(JSON.parse(readFileSync(join(directory,"state.json"),"utf8"))).toMatchObject({allocatedThrough:6,acknowledgedThrough:0});
  unlinkSync(join(directory,files.find(name=>name.startsWith("6-"))!));
  const blocked = await fixture.cli(args);
  expect(blocked.code).toBe(3);
  expect(blocked.stderr).toContain("missing_sequence");
  expect(JSON.parse(readFileSync(join(directory,"state.json"),"utf8")).allocatedThrough).toBe(6);
});

it("recovers an immutable envelope from a durable descriptor after record publication fails", async () => {
  const server = await launch();
  const fixture = await registeredRun(server);
  const config = {port:server.port,token:server.credentials().reporterToken,outbox:fixture.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined};
  let fail = true;
  const outbox = await openOutbox(config,performance.now()+5000,{createFile(path,body){if(fail && /\/1-/.test(path)){fail=false;throw new Error("fixture write failure");}createFile(path,body);},renameSync,unlinkSync,syncDirectory});
  try {await expect(outbox.enqueue(fixture.runId,"run.started",{})).rejects.toThrow("fixture write failure");} finally {outbox.close();}
  const directory = join(config.outbox,fixture.runId);
  const pending = JSON.parse(readFileSync(join(directory,"state.json"),"utf8"));
  expect(pending).toMatchObject({allocatedThrough:1,acknowledgedThrough:0,pending:{record:{body:{sequence:1,type:"run.started"}}}});
  const flushed = await fixture.cli(["flush","--run",fixture.runId]);
  expect(flushed.code).toBe(0);
  expect(JSON.parse(flushed.stdout).eventId).toBe(pending.pending.record.body.eventId);
  expect(readdirSync(directory)).toEqual(["state.json"]);
  await server.stop();
});

it("counts owned metadata at the run limit and rejects unsafe files without silently dropping observations", async () => {
  const server = await launch();
  const fixture = await registeredRun(server);
  await server.stop();
  const directory = join(fixture.env.AGENTFLOW_OUTBOX_DIR,fixture.runId);
  const statePath = join(directory,"state.json");
  const old = readFileSync(statePath);
  writeFileSync(statePath,Buffer.concat([old,Buffer.alloc(10*1024*1024-old.length,32)]));
  const result = await fixture.cli(["report","--run",fixture.runId,"--type","run.started","--payload",fixture.file({})]);
  expect(result.code).toBe(1);
  expect(readFileSync(statePath).length).toBe(10*1024*1024);
  writeFileSync(statePath,old); chmodSync(statePath,0o644);
  const unsafe = await fixture.cli(["report","--run",fixture.runId,"--type","run.started","--payload",fixture.file({})]);
  expect(unsafe.code).toBe(1);
  expect(readdirSync(directory)).toEqual(["state.json"]);
});

it.each(["descriptor-temp","descriptor","record","clear","ack","unlink"])("survives real SIGKILL at %s without reusing sequence or duplicating a committed observation", async phase => {
  const { spawn } = await import("node:child_process");
  const Database = (await import("better-sqlite3")).default;
  const server = await launch();
  const fixture = await registeredRun(server);
  try {
    const child = spawn(process.execPath,["--import","tsx","tests/fixtures/p06-crash-cli.ts",phase,"report","--run",fixture.runId,"--type","run.started","--payload",fixture.file({})],{env:{...process.env,...fixture.env},stdio:"ignore"});
    const signal = await new Promise<string | null>(resolve=>child.on("exit",(_code,signal)=>resolve(signal)));
    expect(signal).toBe("SIGKILL");
    const before = JSON.parse(readFileSync(join(fixture.env.AGENTFLOW_OUTBOX_DIR,fixture.runId,"state.json"),"utf8"));
    const original = before.pending?.record.body.eventId || readdirSync(join(fixture.env.AGENTFLOW_OUTBOX_DIR,fixture.runId)).find(name=>name.startsWith("1-"))?.slice(2,-5);
    const flushed = await fixture.cli(["flush","--run",fixture.runId]);
    expect(flushed.code).toBe(0);
    const db = new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});
    try {
      expect(db.prepare("SELECT count(*) n FROM run_events").get()).toEqual({n:phase==="descriptor-temp"?0:1});
      if(original)expect(db.prepare("SELECT event_id FROM run_events").get()).toEqual({event_id:original});
    } finally {db.close();}
    const state = JSON.parse(readFileSync(join(fixture.env.AGENTFLOW_OUTBOX_DIR,fixture.runId,"state.json"),"utf8"));
    expect(state.allocatedThrough).toBe(phase==="descriptor-temp"?0:1);
    expect(state.acknowledgedThrough).toBe(state.allocatedThrough);
  } finally {await server.stop();}
});

it("recomputes a dead owner's descriptor reservation for a follower already open near the real 10 MiB ceiling", async () => {
  const { randomUUID } = await import("node:crypto");
  const { lstatSync } = await import("node:fs");
  const { canonicalDigest } = await import("../../src/domain/request-digest");
  const server = await launch();
  const fixture = await registeredRun(server);
  const directory = join(fixture.env.AGENTFLOW_OUTBOX_DIR,fixture.runId);
  const statePath = join(directory,"state.json");
  const initial = JSON.parse(readFileSync(statePath,"utf8"));
  let sequence = 0, bytes = readFileSync(statePath).length;
  while(bytes < 10*1024*1024-75000) {
    const body = {schemaVersion:1,eventId:randomUUID(),runId:fixture.runId,sequence:++sequence,type:sequence===1?"run.started":"run.progress",occurredAt:"2026-10-10T00:00:00.000Z",payload:sequence===1?{}:{message:"\0".repeat(4000)}};
    const encoded = JSON.stringify({formatVersion:1,body,digest:canonicalDigest(body)});
    writeFileSync(join(directory,`${sequence}-${body.eventId}.json`),encoded,{mode:0o600});bytes+=Buffer.byteLength(encoded);
  }
  writeFileSync(statePath,JSON.stringify({...initial,allocatedThrough:sequence}));
  const config = {port:server.port,token:server.credentials().reporterToken,outbox:fixture.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined};
  const follower = await openOutbox(config,performance.now()+5000);
  let original: string | undefined;
  let fail = true;
  const owner = await openOutbox(config,performance.now()+5000,{createFile,renameSync(from,to){renameSync(from,to);if(fail && String(to).endsWith("state.json")){const value=JSON.parse(readFileSync(to,"utf8"));if(value.pending){original=value.pending.record.body.eventId;fail=false;throw new Error("owner interrupted after descriptor");}}},unlinkSync,syncDirectory});
  try {
    await expect(owner.enqueue(fixture.runId,"run.progress",{message:"\0".repeat(4000)})).rejects.toThrow("owner interrupted");
    owner.close();
    await expect(follower.enqueue(fixture.runId,"run.progress",{message:"\0".repeat(4000)})).rejects.toThrow("outbox_full");
    const final = JSON.parse(readFileSync(statePath,"utf8"));
    expect(final.allocatedThrough).toBe(sequence+1);
    expect(final.pending).toBeUndefined();
    expect(JSON.parse(readFileSync(join(directory,`${sequence+1}-${original}.json`),"utf8")).body.eventId).toBe(original);
    const actual = readdirSync(directory).reduce((sum,name)=>sum+lstatSync(join(directory,name)).size,0);
    expect(actual).toBeLessThanOrEqual(10*1024*1024);
  } finally {if(owner)try{owner.close();}catch{} follower.close();await server.stop();}
});
