import { spawn } from "node:child_process";
import { readFileSync,readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
it.each(["accounting_deadline","publication_busy"].flatMap(point=>["report","registration"].map(kind=>({point,kind}))))("returns queued after completed $kind preservation when $point prevents further delivery",async({point,kind})=> {
  const server=await launch(),f=await registeredRun(server),key=randomUUID();
  const args=kind==="report"?["report","--run",f.runId,"--type","run.started","--payload",f.file({})]:["project","create","--file",f.file({name:"  PRIVATE-P06-DEADLINE-PROJECT  "}),"--idempotency-key",key];
  try {
    const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-preserved-deadline.ts",point,...args],{env:{...process.env,...f.env},stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);
    expect(await new Promise(resolve=>child.on("exit",resolve))).toBe(2);expect(stdout).toBe("");expect(stderr).toContain('"queued"');expect(stderr).not.toContain("PRIVATE-P06");
    const directory=join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId),filename=kind==="report"?join(directory,readdirSync(directory).find(name=>name.startsWith("1-"))!):join(f.env.AGENTFLOW_OUTBOX_DIR,`registration-${key}.json`),original=JSON.parse(readFileSync(filename,"utf8"));
    const replay=await f.cli(kind==="report"?["flush","--run",f.runId]:args);expect(replay.code).toBe(0);
    const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{if(kind==="report"){expect(db.prepare("SELECT count(*) n FROM run_events").get()).toEqual({n:1});expect(db.prepare("SELECT event_id FROM run_events").get()).toEqual({event_id:original.body.eventId});}else{expect(original.key).toBe(key);expect(original.body).toEqual({name:"  PRIVATE-P06-DEADLINE-PROJECT  "});expect(db.prepare("SELECT count(*) n FROM projects").get()).toEqual({n:2});}}finally{db.close();}
  }finally{await server.stop();}
});
