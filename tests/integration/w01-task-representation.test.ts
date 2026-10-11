import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { launch } from "../fixtures/server";
it("projects original task receipts only for a narrow task-create preference",async()=>{
 let server=await launch();try{
  const call=(path:string,input?:unknown,key=randomUUID(),prefer?:string,method=input?"POST":"GET")=>fetch(server.url+"/api/v1"+path,{method,headers:{Authorization:"Bearer "+server.credentials().reporterToken,"Content-Type":"application/json","Idempotency-Key":key,...(prefer?{Prefer:prefer}:{})},...(input?{body:JSON.stringify(input)}:{})});
  const p=await call("/projects",{name:"Synthetic original representation"});const projectId=(await p.json()).data.id;
  const input={projectId,title:"Original synthetic task"},key=randomUUID();const full=await call("/tasks",input,key);expect(full.status).toBe(201);const original=await full.json();
  const minimal=await call("/tasks",input,key,"return=minimal");expect(minimal.headers.get("Preference-Applied")).toBe("return=minimal");expect(minimal.headers.get("Vary")).toContain("Prefer");expect(minimal.headers.get("Cache-Control")).toBe("no-store");const compact=await minimal.json();expect(compact).toEqual({...original,data:{kind:"task",id:original.data.id,projectId,parentTaskId:null,assignedAgentId:null,version:1,workRevision:1}});
  expect((await call(`/tasks/${original.data.id}`,{expectedVersion:1,title:"Current synthetic task"},randomUUID(),undefined,"PATCH")).status).toBe(200);
  expect(await(await call("/tasks",input,key,"  RETURN = minimal  ")).json()).toEqual(compact);
  expect(await(await call("/tasks",input,key)).json()).toEqual(original);
  expect((await(await call(`/tasks/${original.data.id}`)).json()).data.task.title).toBe("Current synthetic task");
  for(const ignored of["return=MINIMAL","return=Minimal","return=minimal-extra","return=minimal, return=minimal","return=minimal, return=representation","unrelated=return=minimal","return=minimal; x=y"]){const response=await call("/tasks",input,key,ignored);expect(response.headers.get("Preference-Applied")).toBeNull();expect(await response.json()).toEqual(original);}
  const conflict=await call("/tasks",{...input,title:"Changed body"},key,"return=minimal");expect(conflict.status).toBe(409);expect(conflict.headers.get("Preference-Applied")).toBeNull();
  expect((await call(`/projects/${projectId}`,{expectedVersion:1,archived:true},randomUUID(),undefined,"PATCH")).status).toBe(200);
  expect(await(await call("/tasks",input,key,"return=minimal")).json()).toEqual(compact);
  const dir=server.dir,port=server.port;await server.stop();server=await launch({dir,port});expect(await(await call("/tasks",input,key,"return=minimal")).json()).toEqual(compact);
  const ignored=await call("/projects",{name:"Other synthetic"},randomUUID(),"return=minimal");expect(ignored.headers.get("Preference-Applied")).toBeNull();expect((await ignored.json()).data.name).toBe("Other synthetic");
 }finally{await server.stop();}
});
it("keeps minimal-first full replay original while current GET and restored generation advance",async()=>{
 const {openOwnedStore}=await import("../../src/db"),{restore}=await import("../../src/db/recovery"),{join}=await import("node:path");let server=await launch();
 try{
  const call=(path:string,input?:unknown,key=randomUUID(),prefer?:string,method=input?"POST":"GET")=>fetch(server.url+"/api/v1"+path,{method,headers:{Authorization:"Bearer "+server.credentials().reporterToken,"Content-Type":"application/json","Idempotency-Key":key,...(prefer?{Prefer:prefer}:{})},...(input?{body:JSON.stringify(input)}:{})});
  const p=await call("/projects",{name:"Synthetic restored representation"}),projectId=(await p.json()).data.id,input={projectId,title:"Original creation"},key=randomUUID();
  const compactResponse=await call("/tasks",input,key,"return=minimal");expect(compactResponse.status).toBe(201);const compact=await compactResponse.json(),id=compact.data.id;
  const full=await(await call("/tasks",input,key)).json();expect(full.data.title).toBe("Original creation");expect(full.snapshotCursor).toBe(compact.snapshotCursor);expect(full.generation).toBe(compact.generation);
  expect((await call(`/tasks/${id}`,{expectedVersion:1,title:"Current creation"},randomUUID(),undefined,"PATCH")).status).toBe(200);
  const dir=server.dir,port=server.port;await server.stop();const owned=await openOwnedStore(dir),backup=join(dir,"backups","task-representation.sqlite");await owned.store.backup(backup);owned.close();await restore(dir,backup);server=await launch({dir,port});
  const restored=await call("/tasks",input,key,"return=minimal");expect(restored.status).toBe(201);expect(restored.headers.get("AgentFlow-Generation")).not.toBe(compact.generation);expect(await restored.json()).toEqual(compact);
  expect(await(await call("/tasks",input,key)).json()).toEqual(full);expect((await(await call(`/tasks/${id}`)).json()).data.task.title).toBe("Current creation");
 }finally{await server.stop();}
});
