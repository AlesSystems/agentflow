import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { migrations, openOwnedStore, Store } from "../../src/db";
import { acquireInstance } from "../../src/server/instance";
import { eventInput } from "../../src/contracts/observations";
import type { ApplicationCommand } from "../../src/db/application";
import { canonicalDigest } from "../../src/domain/request-digest";
const directory=()=>mkdtempSync(join(realpathSync(tmpdir()),"w03c-usage-"));
function commands(store:Store) { return (command:ApplicationCommand,now=1000)=>store.command(command,{principal:"reporter",method:"POST",path:command.kind,key:randomUUID(),digest:canonicalDigest(command.input),now}); }
async function running() {
 const dir=directory(),owned=await openOwnedStore(dir),send=commands(owned.store);
 const projectId=(send({kind:"project.create",input:{name:"Synthetic usage"}}).body.data as {id:string}).id;
 const agentId=(send({kind:"agent.create",input:{displayName:"Synthetic",source:"fixture",defaultRole:"orchestrator"}}).body.data as {id:string}).id;
 const id=randomUUID();send({kind:"run.register",input:{id,projectId,agentId,purpose:"planning"}});
 const emit=(sequence:number,type:string,payload:unknown,now=2000)=>send({kind:"run.event",id,input:eventInput.parse({schemaVersion:1,eventId:randomUUID(),runId:id,sequence,type,payload,occurredAt:"2026-10-12T00:00:00.000Z"})},now);
 return {dir,owned,id,emit,send};
}
const payload={usageId:"stable-1",source:"fixture",model:"model",measuredAt:"2026-10-12T00:00:00.000Z",inputTokens:null,outputTokens:7};
it("rejects_changed_logical_usage_without_consuming_sequence",async()=>{
 const {dir,owned,emit,id}=await running();const db=new Database(join(dir,"agentflow.sqlite"));
 try {
 emit(1,"run.started",{});emit(2,"run.usage",payload);emit(3,"run.usage",payload,3000);
 expect(db.prepare("SELECT count(*) n FROM usage_measurements").get()).toEqual({n:1});
 const state=()=>({run:db.prepare("SELECT * FROM runs WHERE id=?").get(id),events:db.prepare("SELECT * FROM run_events").all(),changes:db.prepare("SELECT * FROM changes").all(),usage:db.prepare("SELECT * FROM usage_measurements").all()});const before=state();
 expect(()=>emit(4,"run.usage",{...payload,outputTokens:8})).toThrow("usage_conflict");expect(state()).toEqual(before);
 expect(()=>emit(4,"run.usage",{...payload,billingBasis:"unrepresented"})).toThrow("usage_conflict");expect(state()).toEqual(before);
 for(const sql of ["UPDATE usage_measurements SET output_tokens=8","DELETE FROM usage_measurements","INSERT OR REPLACE INTO usage_measurements SELECT * FROM usage_measurements"]) expect(()=>db.exec(sql)).toThrow("usage_immutable");
 }finally{db.close();owned.close();}
});
it("preserves_exact_retry_before_terminal_lifecycle",async()=>{
 const {owned,emit,id,send}=await running();try{
 expect(()=>emit(1,"run.usage",payload)).toThrow("run_transition_invalid");emit(1,"run.started",{});
 const input=eventInput.parse({schemaVersion:1,eventId:randomUUID(),runId:id,sequence:2,type:"run.usage",payload,occurredAt:"2026-10-12T00:00:00.000Z"});const first=send({kind:"run.event",id,input});emit(3,"run.succeeded",{summary:"Synthetic"});
 expect(send({kind:"run.event",id,input},9000)).toEqual({...first,status:200});expect(()=>emit(4,"run.usage",{...payload,usageId:"new"})).toThrow("run_terminal");
 }finally{owned.close();}
});
function facts(db:Database.Database){return Object.fromEntries(["run_events","runs","run_order_allocator","receipts","changes","sqlite_sequence","gate_decisions","task_artifacts"].map(t=>[t,db.prepare(`SELECT rowid,* FROM ${t} ORDER BY rowid`).all()]));}
async function oldFixture(){
 const dir=directory(),old=await openOwnedStore(dir,migrations.slice(0,10)),send=commands(old.store);
 const projectId=(send({kind:"project.create",input:{name:"Synthetic upgrade"}}).body.data as {id:string}).id;
 const agentId=(send({kind:"agent.create",input:{displayName:"Synthetic",source:"fixture",defaultRole:"orchestrator"}}).body.data as {id:string}).id;
 const id=randomUUID();send({kind:"run.register",input:{id,projectId,agentId,purpose:"planning"}});
 for(const [sequence,type,payload] of [[1,"run.started",{}],[2,"run.progress",{message:"Synthetic"}],[3,"run.succeeded",{summary:"Synthetic"}]] as const)send({kind:"run.event",id,input:eventInput.parse({schemaVersion:1,eventId:randomUUID(),runId:id,sequence,type,payload,occurredAt:"2026-10-12T00:00:00.000Z"})});
 old.close();const db=new Database(join(dir,"agentflow.sqlite"));db.pragma("foreign_keys=ON");db.exec("UPDATE run_events SET body=json_set(body,'$.payload',NULL),payload_pruned_at=2000 WHERE type='run.progress'");const before=facts(db),schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all();db.close();return {dir,before,schema};
}
it("rebuild_preserves_pruned_events_and_gate_fks",async()=>{
 const {dir,before}=await oldFixture();const owned=await openOwnedStore(dir);const db=new Database(join(dir,"agentflow.sqlite"));try{expect(facts(db)).toEqual(before);expect(owned.store.pragmas().foreign_keys).toBe(1);expect(owned.store.integrity().integrity).toBe("ok");expect(owned.store.metadata().schemaVersion).toBe(11);}finally{db.close();owned.close();}
});
it.each(["copy","drop"])("failed_rebuild_rolls_back_and_reenables_fks after %s",async(stage)=>{
 const {dir,before,schema}=await oldFixture();expect(migrations).toHaveLength(11);
 const migration=migrations[10],needle=stage==="copy"?"DROP TABLE run_events;":"ALTER TABLE run_events_new RENAME TO run_events;";
 const sql=migration.sql.replace(needle,"INSERT INTO missing_w03c_fault VALUES(1);"+needle);expect(sql).not.toBe(migration.sql);
 const owner=acquireInstance(dir),store=new Store(owner);try{
 await expect(store.migrate([...migrations.slice(0,10),{...migration,sql,sha256:createHash("sha256").update(sql).digest("hex")}])).rejects.toThrow("missing_w03c_fault");
 expect(store.pragmas().foreign_keys).toBe(1);expect(store.integrity().integrity).toBe("ok");
 const db=new Database(join(dir,"agentflow.sqlite"));try{expect(facts(db)).toEqual(before);expect(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all()).toEqual(schema);}finally{db.close();}
 expect(readdirSync(join(dir,"backups")).filter(x=>x.endsWith(".sqlite"))).toHaveLength(1);
 }finally{store.close();owner.release();}
});
