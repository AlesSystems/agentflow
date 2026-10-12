import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openOwnedStore } from "../../src/db";
import { canonicalDigest } from "../../src/domain/request-digest";
import type { ApplicationCommand } from "../../src/db/application";
import { eventInput } from "../../src/contracts/observations";

async function fixture() {
 const owned=await openOwnedStore(mkdtempSync(join(realpathSync(tmpdir()),"w03b-retention-")));
 const send=(command:ApplicationCommand,now=1000)=>owned.store.command(command,{principal:"operator",method:"POST",path:command.kind,key:randomUUID(),digest:canonicalDigest(command),now});
 const projectId=(send({kind:"project.create",input:{name:"Synthetic retention"}}).body.data as {id:string}).id;
 const agentId=(send({kind:"agent.create",input:{displayName:"Synthetic",source:"fixture",defaultRole:"implementation"}}).body.data as {id:string}).id;
 const taskId=(send({kind:"task.create",input:{projectId,title:"Synthetic task"}}).body.data as {id:string}).id;
 const runId=randomUUID();send({kind:"run.register",input:{id:runId,projectId,agentId,taskId,purpose:"implementation",expectedTaskVersion:1,workRevision:1}});
 const eventId=randomUUID();
 for(const [sequence,type,payload] of [[1,"run.started",{}],[2,"run.progress",{message:"obsolete display body"}],[3,"run.succeeded",{summary:"terminal evidence"}]] as const)
  send({kind:"run.event",id:runId,input:eventInput.parse({schemaVersion:1,eventId:sequence===2?eventId:randomUUID(),runId,sequence,type,payload,occurredAt:new Date(1000).toISOString()})});
 const db=new Database(join(owned.store.dataDir,"agentflow.sqlite"));db.pragma("foreign_keys=ON");
 return {owned,db,send,runId,eventId,close(){db.close();owned.close();}};
}
it("allows exactly the first eligible display-payload transition while preserving identity and ACK",async()=>{
 const f=await fixture();try {
  const old=f.db.prepare("SELECT * FROM run_events WHERE event_id=?").get(f.eventId) as Record<string,unknown>;
  expect(()=>f.db.prepare("UPDATE run_events SET body=json_set(body,'$.payload',NULL),payload_pruned_at=2000 WHERE event_id=?").run(f.eventId)).not.toThrow();
  const current=f.db.prepare("SELECT * FROM run_events WHERE event_id=?").get(f.eventId) as Record<string,unknown>;
  expect(JSON.parse(current.body as string).payload).toBe(null);
  for(const key of Object.keys(old).filter(key=>!["body","payload_pruned_at"].includes(key)))expect(current[key]).toEqual(old[key]);
 }finally{f.close();}
});
