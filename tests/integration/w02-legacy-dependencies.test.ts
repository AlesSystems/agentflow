import { mkdtempSync,realpathSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { expect,it } from "vitest";
import { migrations,openOwnedStore } from "../../src/db";
import { launch,pair } from "../fixtures/server";
it("preserves migrated uppercase UUIDs through prerequisite self checks, DAG checks and foreign keys",async()=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),"w02-legacy-"));const old=await openOwnedStore(dir,migrations.slice(0,7));old.close();
 const project="DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD",target="AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",prerequisite="BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
 const seed=new Database(join(dir,"agentflow.sqlite"));seed.pragma("foreign_keys=ON");seed.prepare("INSERT INTO projects VALUES(?,'Synthetic legacy',NULL,NULL,1,0,0)").run(project);
 for(const id of [target,prerequisite])seed.prepare("INSERT INTO tasks(id,project_id,title,description,acceptance_criteria,status,priority,tags,version,work_revision,created_at,updated_at) VALUES(?,?,'Legacy','','','backlog','normal','[]',1,1,0,0)").run(id,project);seed.close();
 const server=await launch({dir});const cookie=await pair(server);const transcript:unknown[]=[];
 const call=async(id:string,input:unknown,key=randomUUID())=>{const r=await fetch(server.url+"/api/v1/tasks/"+id.toLowerCase()+"/dependencies",{method:"PUT",headers:{Cookie:cookie,Origin:server.url,"Content-Type":"application/json","Idempotency-Key":key},body:JSON.stringify(input)});transcript.push({id,input,key,status:r.status,body:await r.clone().json()});return r;};
 try{
  const key=randomUUID(),input={expectedVersion:1,prerequisiteIds:[prerequisite.toLowerCase()]};
  const response=await call(target,input,key);expect(response.status).toBe(200);const original=await response.json();
  const readiness=await fetch(server.url+"/api/v1/tasks/"+target.toLowerCase()+"/readiness",{headers:{Cookie:cookie}});expect(readiness.status).toBe(200);const facts=await readiness.json();
  expect(facts.data).toEqual({ready:false,blockedPrerequisiteIds:[prerequisite],prerequisites:[{taskId:prerequisite,currentWorkRevision:1,acceptedWorkRevision:null,status:"backlog",reason:"not_completed"}]});
  const retry=await call(target,input,key);expect(retry.status).toBe(200);expect(await retry.json()).toEqual(original);
  const refreshed=await fetch(server.url+"/api/v1/tasks/"+target.toLowerCase()+"/readiness",{headers:{Cookie:cookie}});expect(await refreshed.json()).toEqual(facts);transcript.push({readiness:facts,original});
  const db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT * FROM task_dependencies").all()).toEqual([{task_id:target,prerequisite_id:prerequisite,project_id:project}]);expect(db.pragma("foreign_key_check")).toEqual([]);expect(db.prepare("SELECT version FROM tasks WHERE id=?").get(target)).toEqual({version:2});expect(db.prepare("SELECT count(*) n FROM receipts").get()).toEqual({n:1});}finally{db.close();}
  expect((await call(target,{expectedVersion:2,prerequisiteIds:[target.toLowerCase()]})).status).toBe(409);
  expect((await call(prerequisite,{expectedVersion:1,prerequisiteIds:[target.toLowerCase()]})).status).toBe(409);
 }finally{if(process.env.AGENTFLOW_W02_EVIDENCE_DIR)writeFileSync(join(process.env.AGENTFLOW_W02_EVIDENCE_DIR,"legacy-dependencies.json"),JSON.stringify({dir,transcript},null,2),{mode:0o600});await server.stop();}
});
