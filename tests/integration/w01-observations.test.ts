import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { join } from "node:path";
import { launch, pair } from "../fixtures/server";
it("binds attempts to immutable plans and preserves append-only linked node evidence", async () => {
 let server = await launch();
 try {
  const call = (path: string, input?: unknown, human?: string) => fetch(server.url + "/api/v1" + path, { method: input ? "POST" : "GET", headers: { ...(human ? { Cookie: human, Origin: server.url } : { Authorization: "Bearer " + server.credentials().reporterToken }), "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, ...(input ? { body: JSON.stringify(input) } : {}) });
  const create = async (path: string, input: unknown) => { const r = await call(path, input); expect(r.status).toBe(201); return (await r.json()).data; };
  const project = await create("/projects", { name: "Synthetic observation" });
  const task = await create("/tasks", { projectId: project.id, title: "Preserved task" });
  const agent = await create("/agents", { displayName: "Synthetic", source: "W01", defaultRole: "implementation" });
  const taskRun = await create("/runs", { id: randomUUID(), projectId: project.id, agentId: agent.id, taskId: task.id, purpose: "verification", expectedTaskVersion: 1 });
  const workflow = await create("/workflows", { id: randomUUID(), projectId: project.id, name: "Branching" });
  const nodeId = randomUUID(), unknownNode = randomUUID();
  const revision = await create(`/workflows/${workflow.id}/revisions`, { id: randomUUID(), expectedWorkflowVersion: 1, nodes: [{ id: nodeId, label: "Node", taskId: task.id }, { id: unknownNode, label: "Unreported" }], edges: [{ source: nodeId, target: unknownNode }] });
  const registration = { id: randomUUID(), workflowId: workflow.id, planRevisionId: revision.id };
  const run = await create("/workflow-runs", registration);
  expect(run.state).toBe("queued");
  expect((await call("/workflow-runs", { ...registration, id: randomUUID() })).status).toBe(409);
  const event = (sequence: number, type: string, payload: unknown) => ({ schemaVersion: 1, eventId: randomUUID(), workflowRunId: run.id, sequence, occurredAt: "2026-10-11T00:00:00Z", type, payload });
  const started = event(1, "workflow.started", {});
  const start = await call(`/workflow-runs/${run.id}/events`, started); expect(start.status).toBe(201); const originalAck = await start.json();
  await create(`/workflow-runs/${run.id}/events`, event(2, "workflow.node.reported", { nodeId, runId: taskRun.id, state: "running", reportedSkill: { name: "<script>alert(1)</script>", source: "file:///private/inert" } }));
  await create(`/workflow-runs/${run.id}/events`, event(3, "workflow.node.reported", { nodeId, state: "succeeded" }));
  const snapshot = await call(`/workflow-runs/${run.id}/snapshot`); expect(snapshot.status).toBe(200); const state = (await snapshot.json()).data;
  expect(state.nodes).toHaveLength(2);
  expect(state.nodes.find((n: { nodeId: string }) => n.nodeId === nodeId).observation.payload.reportedSkill).toBeUndefined();
  expect(state.nodes.find((n: { nodeId: string }) => n.nodeId === unknownNode).observation).toBeNull();
  const history = await call(`/workflow-runs/${run.id}/nodes/${nodeId}/observations`);
  expect(history.status).toBe(200); expect((await history.json()).data.items.map((v: { sequence: number }) => v.sequence)).toEqual([3,2]);
  const db = new Database(join(server.dir, "agentflow.sqlite"));
  try {
   const before = db.prepare("SELECT * FROM changes").all();
   for (const bad of [event(5, "workflow.heartbeat", {}), event(4, "workflow.node.reported", { nodeId: randomUUID(), state: "running" }), { ...started, occurredAt: "2026-10-12T00:00:00Z" }]) expect((await call(`/workflow-runs/${run.id}/events`, bad)).status).toBe(409);
   expect(db.prepare("SELECT * FROM changes").all()).toEqual(before);
   expect((await call(`/workflow-runs/${run.id}/close`, { expectedVersion: 4, reason: "forged" })).status).toBe(403);
   expect((await call(`/workflow-runs/${run.id}/close`, { expectedVersion: 4, reason: "fresh" }, await pair(server))).status).toBe(409);
  } finally { db.close(); }
  await create(`/workflow-runs/${run.id}/events`, event(4, "workflow.succeeded", { summary: "Reported only" }));
  expect((await (await call(`/tasks/${task.id}`)).json()).data.task.status).toBe("backlog");
  const duplicate = await call(`/workflow-runs/${run.id}/events`, started); expect(duplicate.status).toBe(200); expect(await duplicate.json()).toEqual(originalAck);
  await create(`/workflows/${workflow.id}/revisions`, { id: randomUUID(), expectedWorkflowVersion: 2, nodes: [{ id: nodeId, label: "Changed" }], edges: [] });
  const dir = server.dir; await server.stop(); server = await launch({ dir });
  const restarted = await call(`/workflow-runs/${run.id}`); expect((await restarted.json()).data.planRevisionId).toBe(revision.id);
  const adopted = await call("/workflow-runs", registration); expect(adopted.status).toBe(200); expect((await adopted.json()).data.state).toBe("queued");
 } finally { await server.stop(); }
});
it("serializes competing workflow registrations and preserves distinct attempt links while rejecting mismatches",async()=>{
 const server=await launch();
 try{
  const auth={Authorization:"Bearer "+server.credentials().reporterToken,"Content-Type":"application/json"};
  const call=(path:string,input?:unknown)=>fetch(server.url+"/api/v1"+path,{method:input?"POST":"GET",headers:{...auth,"Idempotency-Key":randomUUID()},...(input?{body:JSON.stringify(input)}:{})});
  const create=async(path:string,input:unknown)=>{const r=await call(path,input);expect(r.status).toBe(201);return(await r.json()).data;};
  const project=await create("/projects",{name:"Synthetic contention"}),otherProject=await create("/projects",{name:"Other"});
  const task=await create("/tasks",{projectId:project.id,title:"Linked work"}),wrongTask=await create("/tasks",{projectId:project.id,title:"Wrong work"}),crossTask=await create("/tasks",{projectId:otherProject.id,title:"Cross project"});
  const agent=await create("/agents",{displayName:"Synthetic",source:"W01",defaultRole:"verifier"});
  const workflow=await create("/workflows",{id:randomUUID(),projectId:project.id,name:"Links"}),nodeId=randomUUID();
  const revision=await create(`/workflows/${workflow.id}/revisions`,{id:randomUUID(),expectedWorkflowVersion:1,nodes:[{id:nodeId,label:"Node",taskId:task.id}],edges:[]});
  const candidates=[0,1].map(()=>({id:randomUUID(),workflowId:workflow.id,planRevisionId:revision.id}));const responses=await Promise.all(candidates.map(input=>call("/workflow-runs",input)));expect(responses.map(r=>r.status).sort()).toEqual([201,409]);const wfRunId=candidates[responses.findIndex(r=>r.status===201)].id;
  const event=(sequence:number,payload:unknown,type="workflow.node.reported")=>({schemaVersion:1,eventId:randomUUID(),workflowRunId:wfRunId,sequence,occurredAt:"2026-10-11T00:00:00Z",type,payload});
  await create(`/workflow-runs/${wfRunId}/events`,event(1,{},"workflow.started"));
  const linked1=await create("/runs",{id:randomUUID(),projectId:project.id,agentId:agent.id,taskId:task.id,purpose:"verification",expectedTaskVersion:1});
  await create(`/workflow-runs/${wfRunId}/events`,event(2,{nodeId,runId:linked1.id,state:"running",reportedSkill:{name:"First only"}}));
  for(const [index,type,payload] of [[1,"run.started",{}],[2,"run.succeeded",{summary:"Synthetic verification"}]] as [number,string,unknown][])await create(`/runs/${linked1.id}/events`,{schemaVersion:1,eventId:randomUUID(),runId:linked1.id,sequence:index,occurredAt:"2026-10-11T00:00:00Z",type,payload});
  const linked2=await create("/runs",{id:randomUUID(),projectId:project.id,agentId:agent.id,taskId:task.id,purpose:"verification",expectedTaskVersion:2});
  await create(`/workflow-runs/${wfRunId}/events`,event(3,{nodeId,runId:linked2.id,state:"running"}));
  const history=(await(await call(`/workflow-runs/${wfRunId}/nodes/${nodeId}/observations`)).json()).data.items;expect(history.map((v:{payload:{runId:string}})=>v.payload.runId)).toEqual([linked2.id,linked1.id]);expect(history[0].payload.reportedSkill).toBeUndefined();
  const wrong=await create("/runs",{id:randomUUID(),projectId:project.id,agentId:agent.id,taskId:wrongTask.id,purpose:"verification",expectedTaskVersion:1}),cross=await create("/runs",{id:randomUUID(),projectId:otherProject.id,agentId:agent.id,taskId:crossTask.id,purpose:"verification",expectedTaskVersion:1});
  const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{const before=db.prepare("SELECT * FROM workflow_events").all();for(const runId of[wrong.id,cross.id])expect((await call(`/workflow-runs/${wfRunId}/events`,event(4,{nodeId,runId,state:"running"}))).status).toBe(409);expect(db.prepare("SELECT * FROM workflow_events").all()).toEqual(before);}finally{db.close();}
 }finally{await server.stop();}
});
it("serializes a fresh report against a human stale close without refreshing closure evidence",async()=>{
 const server=await launch();
 try{
  const call=(path:string,input:unknown,cookie?:string)=>fetch(server.url+"/api/v1"+path,{method:"POST",headers:{...(cookie?{Cookie:cookie,Origin:server.url}:{Authorization:"Bearer "+server.credentials().reporterToken}),"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify(input)});
  const create=async(path:string,input:unknown)=>{const r=await call(path,input);expect(r.status).toBe(201);return(await r.json()).data;};
  const project=await create("/projects",{name:"Synthetic race"}),workflow=await create("/workflows",{id:randomUUID(),projectId:project.id,name:"Close race"}),revision=await create(`/workflows/${workflow.id}/revisions`,{id:randomUUID(),expectedWorkflowVersion:1,nodes:[{id:randomUUID(),label:"Node"}],edges:[]}),run=await create("/workflow-runs",{id:randomUUID(),workflowId:workflow.id,planRevisionId:revision.id});
  const db=new Database(join(server.dir,"agentflow.sqlite"));try{db.prepare("UPDATE workflow_runs SET last_received_at=0 WHERE id=?").run(run.id);const cookie=await pair(server);const responses=await Promise.all([call(`/workflow-runs/${run.id}/events`,{schemaVersion:1,eventId:randomUUID(),workflowRunId:run.id,sequence:1,occurredAt:"2026-10-11T00:00:00Z",type:"workflow.started",payload:{}}),call(`/workflow-runs/${run.id}/close`,{expectedVersion:1,reason:"Synthetic stale race"},cookie)]);expect(responses.filter(r=>r.ok)).toHaveLength(1);expect(responses.filter(r=>r.status===409)).toHaveLength(1);const state=db.prepare("SELECT state,last_received_at,version FROM workflow_runs WHERE id=?").get(run.id) as {state:string;last_received_at:number;version:number};expect(state.version).toBe(2);if(state.state==="interrupted")expect(state.last_received_at).toBe(0);else expect(state.state).toBe("running");}finally{db.close();}
 }finally{await server.stop();}
});
it("links real uppercase legacy task attempts and lists their original project identity",async()=>{
 const {mkdtempSync,realpathSync}=await import("node:fs"),{tmpdir}=await import("node:os"),{openOwnedStore,migrations}=await import("../../src/db");
 const dir=mkdtempSync(join(realpathSync(tmpdir()),"agentflow-w01-legacy-links-")),owned=await openOwnedStore(dir,migrations.slice(0,2));
 const projectId=randomUUID().toUpperCase(),taskId=randomUUID().toUpperCase(),agentId=randomUUID().toUpperCase(),runId=randomUUID().toUpperCase();const db=new Database(join(dir,"agentflow.sqlite"));
 db.pragma("foreign_keys=ON");db.prepare("INSERT INTO projects VALUES(?,'Synthetic legacy',NULL,NULL,1,0,0)").run(projectId);db.prepare("INSERT INTO agents VALUES(?,'Synthetic','legacy','verifier',1,0)").run(agentId);db.prepare("INSERT INTO tasks(id,project_id,title,description,acceptance_criteria,status,priority,tags,version,work_revision,created_at,updated_at) VALUES(?,?,'Synthetic','','','backlog','normal','[]',1,1,0,0)").run(taskId,projectId);db.prepare("INSERT INTO runs(id,project_id,agent_id,task_id,purpose,work_revision,state,last_sequence,last_received_at,version,created_at) VALUES(?,?,?,?,'verification',1,'queued',0,0,1,0)").run(runId,projectId,agentId,taskId);db.close();owned.close();
 const server=await launch({dir});try{
  const call=(path:string,input?:unknown)=>fetch(server.url+"/api/v1"+path,{method:input?"POST":"GET",headers:{Authorization:"Bearer "+server.credentials().reporterToken,"Content-Type":"application/json","Idempotency-Key":randomUUID()},...(input?{body:JSON.stringify(input)}:{})});
  const create=async(path:string,input:unknown)=>{const response=await call(path,input),text=await response.text();expect(response.status,text).toBe(201);return JSON.parse(text).data;};
  const workflow=await create("/workflows",{id:randomUUID(),projectId,name:"Legacy references"}),nodeId=randomUUID(),revision=await create(`/workflows/${workflow.id}/revisions`,{id:randomUUID(),expectedWorkflowVersion:1,nodes:[{id:nodeId,label:"Node",taskId}],edges:[]}),wfRun=await create("/workflow-runs",{id:randomUUID(),workflowId:workflow.id,planRevisionId:revision.id});
  await create(`/workflow-runs/${wfRun.id}/events`,{schemaVersion:1,eventId:randomUUID(),workflowRunId:wfRun.id,sequence:1,occurredAt:"2026-10-11T00:00:00Z",type:"workflow.started",payload:{}});
  await create(`/workflow-runs/${wfRun.id}/events`,{schemaVersion:1,eventId:randomUUID(),workflowRunId:wfRun.id,sequence:2,occurredAt:"2026-10-11T00:00:00Z",type:"workflow.node.reported",payload:{nodeId,runId,state:"running"}});
  const list=await call(`/workflows?projectId=${projectId.toLowerCase()}`);expect((await list.json()).data.items.map((v:{id:string})=>v.id)).toEqual([workflow.id]);
 }finally{await server.stop();}
});
