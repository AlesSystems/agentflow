import { spawn } from "node:child_process";
import { readFileSync,readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
const points=["descriptor-write","descriptor-file-sync","descriptor-rename","descriptor-dir-sync","record-write","record-file-sync","record-rename","record-dir-sync","clear-write","clear-rename","clear-dir-sync","ack-write","ack-rename","ack-dir-sync","record-unlink","unlink-dir-sync"];
it.each(points)("preserves recoverable identity and refuses a durability claim after %s failure",async point=> {
  const server=await launch(),f=await registeredRun(server),root=f.env.AGENTFLOW_OUTBOX_DIR,directory=join(root,f.runId);
  try {
    const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-fault-cli.ts",point,"report","--run",f.runId,"--type","run.started","--payload",f.file({})],{env:{...process.env,...f.env},stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);
    expect(await new Promise(resolve=>child.on("exit",resolve))).toBe(1);expect(stdout).toBe("");expect(stderr).not.toContain("PRIVATE-P06-IO");
    const state=JSON.parse(readFileSync(join(directory,"state.json"),"utf8"));
    const file=readdirSync(directory).find(name=>/^1-.*\.json$/.test(name));
    const eventId=state.pending?.record.body.eventId || (file?JSON.parse(readFileSync(join(directory,file),"utf8")).body.eventId:undefined);
    const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});
    try {
      const committed=point.startsWith("ack-")||point.includes("unlink");expect(db.prepare("SELECT count(*) n FROM run_events").get()).toEqual({n:committed?1:0});
      const recovered=await f.cli(["flush","--run",f.runId]);expect(recovered.code).toBe(0);
      const unpublished=["descriptor-write","descriptor-file-sync","descriptor-rename"].includes(point);
      expect(db.prepare("SELECT count(*) n FROM run_events").get()).toEqual({n:unpublished?0:1});
      if(eventId)expect(db.prepare("SELECT event_id FROM run_events").get()).toEqual({event_id:eventId});
      const final=JSON.parse(readFileSync(join(directory,"state.json"),"utf8"));expect(final.allocatedThrough).toBe(unpublished?0:1);expect(final.acknowledgedThrough).toBe(final.allocatedThrough);expect(readdirSync(directory)).toEqual(["state.json"]);
    }finally{db.close();}
  }finally{await server.stop();}
});
