import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect,it } from "vitest";
import { launch,pair } from "../fixtures/server";
import { readinessResponse } from "../../src/contracts/evidence";

it("atomically replaces a diamond and serializes real opposing-edge and prerequisite races",async()=>{
 const server=await launch();const cookie=await pair(server);
 const traces:unknown[]=[];
 const call=async(path:string,input?:unknown,method=input?"POST":"GET",human=false,key=randomUUID())=>{const response=await fetch(server.url+"/api/v1"+path,{method,headers:{...(human?{Cookie:cookie,Origin:server.url}:{Authorization:"Bearer "+server.credentials().reporterToken}),"Content-Type":"application/json","Idempotency-Key":key},...(input?{body:JSON.stringify(input)}:{})});traces.push({path,method,key,input,status:response.status,body:await response.clone().json()});return response;};
 const json=async(path:string,input?:unknown,method?:string,human=false)=>{const response=await call(path,input,method,human);expect(response.ok).toBe(true);return response.json();};
 const current=async(id:string)=>(await json("/tasks/"+id)).data.task;
 const deps=async(id:string,prerequisiteIds:string[])=>call("/tasks/"+id+"/dependencies",{expectedVersion:(await current(id)).version,prerequisiteIds},"PUT",true);
 const accept=async(id:string)=>{await json("/tasks/"+id,{expectedVersion:(await current(id)).version,status:"review"},"PATCH");return call("/tasks/"+id+"/complete",{expectedVersion:(await current(id)).version,evidenceNote:"Synthetic browser-role acceptance"},"POST",true);};
 const reopen=async(id:string)=>call("/tasks/"+id+"/reopen",{expectedVersion:(await current(id)).version,reason:"Synthetic race"},"POST",true);
 const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});
 try{
  const projectId=(await json("/projects",{name:"Synthetic W02 HTTP"})).data.id;
  const agentId=(await json("/agents",{displayName:"Synthetic",source:"HTTP",defaultRole:"implementation"})).data.id;
  const create=async()=> (await json("/tasks",{projectId,title:"Synthetic task"})).data.id as string;
  const [a,b,c,d]=await Promise.all([create(),create(),create(),create()]);
  for(const [id,ids] of [[a,[b,c]],[b,[d]],[c,[d]]] as [string,string[]][])expect((await deps(id,ids)).status).toBe(200);
  expect(readinessResponse.parse(await json("/tasks/"+a+"/readiness")).data).toMatchObject({ready:false,blockedPrerequisiteIds:[b,c].sort()});
  const registration={id:randomUUID(),projectId,agentId,taskId:a,purpose:"implementation",expectedTaskVersion:(await current(a)).version};
  const blocked=await call("/runs",registration);expect(blocked.status).toBe(409);
  expect(await blocked.json()).toMatchObject({error:{code:"dependencies_not_ready",details:{prerequisites:expect.arrayContaining([{taskId:b,currentWorkRevision:1,acceptedWorkRevision:null,status:"backlog",reason:"not_completed"}])}}});
  const before=db.prepare("SELECT count(*) n FROM receipts").get();
  for(const [ids,status] of [[[a],409],[[b,b],409],[[randomUUID()],404]] as [string[],number][])expect((await deps(a,ids)).status).toBe(status);
  expect(db.prepare("SELECT count(*) n FROM receipts").get()).toEqual(before);
  expect((await deps(d,[a])).status).toBe(409);
  const other=(await json("/projects",{name:"Other"})).data.id;
  const foreign=(await json("/tasks",{projectId:other,title:"Foreign"})).data.id;
  expect((await deps(a,[foreign])).status).toBe(409);
  expect((await deps(a,Array.from({length:21},()=>randomUUID()))).status).toBe(422);
  expect((await accept(d)).status).toBe(201);expect((await accept(b)).status).toBe(201);expect((await accept(c)).status).toBe(201);
  expect((await json("/tasks/"+a+"/readiness")).data.ready).toBe(true);
  const oldRevision=(await current(b)).workRevision;
  const rejected=await call("/tasks/"+b,{expectedVersion:(await current(b)).version,title:"completed metadata"},"PATCH");expect(rejected.status).toBe(409);expect((await current(b)).workRevision).toBe(oldRevision);expect((await json("/tasks/"+a+"/readiness")).data.ready).toBe(true);
  const parentChild=(await json("/tasks",{projectId,title:"Grouped child",parentTaskId:a})).data.id;
  expect((await json("/tasks/"+parentChild+"/readiness")).data.ready).toBe(true);
  const workflowId=randomUUID(),first=randomUUID(),second=randomUUID();
  await json("/workflows",{id:workflowId,projectId,name:"Independent reported order"});
  await json("/workflows/"+workflowId+"/revisions",{id:randomUUID(),expectedWorkflowVersion:1,nodes:[{id:first,label:"Blocked",taskId:a},{id:second,label:"Grouped",taskId:parentChild}],edges:[{source:first,target:second}]});
  expect((await json("/tasks/"+parentChild+"/readiness")).data).toMatchObject({ready:true,prerequisites:[]});
  const [x,y]=await Promise.all([create(),create()]);
  const opposing=await Promise.all([deps(x,[y]),deps(y,[x])]);expect(opposing.map(r=>r.status).sort()).toEqual([200,409]);expect(db.prepare("SELECT count(*) n FROM task_dependencies WHERE task_id IN (?,?)").get(x,y)).toEqual({n:1});
  const input={...registration,id:randomUUID(),expectedTaskVersion:(await current(a)).version};
  const regKey=randomUUID();
  const [reg,opened]=await Promise.all([call("/runs",input,"POST",false,regKey),reopen(b)]);expect(opened.status).toBe(200);expect([201,409]).toContain(reg.status);
  expect((await json("/tasks/"+a+"/readiness")).data).toMatchObject({ready:false,blockedPrerequisiteIds:[b]});
  const regBody=await reg.clone().json(),openedBody=await opened.clone().json();
  const reopenCursor=(db.prepare("SELECT cursor FROM changes WHERE entity_type='task' AND entity_id=? AND kind='reopen'").get(b) as {cursor:number}).cursor;
  expect(String(reopenCursor)).toBe(openedBody.snapshotCursor);
  if(reg.status===201){expect(BigInt(regBody.snapshotCursor)).toBeLessThan(BigInt(openedBody.snapshotCursor));expect((db.prepare("SELECT cursor FROM changes WHERE entity_type='task' AND entity_id=? AND kind='run_registered'").get(a) as {cursor:number}).cursor).toBeLessThan(reopenCursor);}
  else {expect(regBody.error.code).toBe("dependencies_not_ready");expect(db.prepare("SELECT count(*) n FROM changes WHERE entity_type='run' AND entity_id=?").get(input.id)).toEqual({n:0});expect(db.prepare("SELECT count(*) n FROM receipts WHERE path='/api/v1/runs' AND key=?").get(regKey)).toEqual({n:0});}
  expect(db.prepare("SELECT count(*) n FROM runs WHERE id=?").get(input.id)).toEqual({n:reg.status===201?1:0});
  if(reg.status===201){
   for(const [sequence,type,payload] of [[1,"run.started",{}],[2,"run.succeeded",{summary:"existing attempt still reports"}]] as const)expect((await call("/runs/"+input.id+"/events",{schemaVersion:1,eventId:randomUUID(),runId:input.id,sequence,occurredAt:new Date().toISOString(),type,payload})).status).toBe(201);
   expect((await call("/tasks/"+a,{expectedVersion:(await current(a)).version,status:"backlog"},"PATCH")).status).toBe(200);
  }
  const [p,q]=await Promise.all([create(),create()]);expect((await accept(p)).status).toBe(201);expect((await deps(q,[p])).status).toBe(200);await json("/tasks/"+q,{expectedVersion:(await current(q)).version,status:"review"},"PATCH");
  const completion={expectedVersion:(await current(q)).version,evidenceNote:"Synthetic race acceptance"};
  const completeKey=randomUUID();
  const [done,unaccepted]=await Promise.all([call("/tasks/"+q+"/complete",completion,"POST",true,completeKey),reopen(p)]);expect(unaccepted.status).toBe(200);expect([201,409]).toContain(done.status);
  expect((await json("/tasks/"+q+"/readiness")).data.ready).toBe(false);expect(db.prepare("SELECT count(*) n FROM completions WHERE task_id=?").get(q)).toEqual({n:done.status===201?1:0});
  const doneBody=await done.clone().json(),unacceptedBody=await unaccepted.clone().json();
  if(done.status===201){expect(BigInt(doneBody.snapshotCursor)).toBeLessThan(BigInt(unacceptedBody.snapshotCursor));const completedCursor=(db.prepare("SELECT cursor FROM changes WHERE entity_type='task' AND entity_id=? AND kind='complete'").get(q) as {cursor:number}).cursor;const prerequisiteCursor=(db.prepare("SELECT cursor FROM changes WHERE entity_type='task' AND entity_id=? AND kind='reopen'").get(p) as {cursor:number}).cursor;expect(completedCursor).toBeLessThan(prerequisiteCursor);}
  else {expect(doneBody.error.code).toBe("dependencies_not_ready");expect(db.prepare("SELECT count(*) n FROM changes WHERE entity_type='task' AND entity_id=? AND kind='complete'").get(q)).toEqual({n:0});expect(db.prepare("SELECT count(*) n FROM receipts WHERE path=? AND key=?").get("/api/v1/tasks/"+q+"/complete",completeKey)).toEqual({n:0});}
  traces.push({raceOrder:{regBody,openedBody,doneBody,unacceptedBody}});
  console.info(JSON.stringify({syntheticRace:{registrationStatus:reg.status,completionStatus:done.status,registrationId:input.id,dependentTaskId:q,readiness:(await json("/tasks/"+q+"/readiness")).data}}));
  for(const [suffix,method,body] of [["dependencies","PUT",{expectedVersion:1,prerequisiteIds:[]}],["review-policy","PATCH",{expectedVersion:1,reviewRequired:false,verificationRequired:false}],["artifact","POST",{expectedVersion:1,artifactRef:"x"}],["rework","POST",{expectedVersion:1,reason:"x"}],["complete","POST",{expectedVersion:1,evidenceNote:"x"}]] as const)expect((await call("/tasks/"+a+"/"+suffix,body,method)).status).toBe(403);
 }finally{if(process.env.AGENTFLOW_W02_EVIDENCE_DIR)writeFileSync(join(process.env.AGENTFLOW_W02_EVIDENCE_DIR,"http-transcript.json"),JSON.stringify({dir:server.dir,traces},null,2),{mode:0o600});db.close();await server.stop();}
},30000);
