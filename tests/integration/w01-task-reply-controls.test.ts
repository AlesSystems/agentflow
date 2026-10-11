import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { cliFixture } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";
import { taskResponse } from "../../src/contracts/responses";
import { taskRegistrationResponse } from "../../src/contracts/task-registration";
for(const control of["wrong-kind","invalid-id","wrong-project","wrong-parent","wrong-agent","wrong-version","unknown-field","missing-applied","oversized"])it(`retains original task registration on ${control} metadata and repairs exact retry`,async()=>{
 const server=await launch();let wrong=true;
 const create=async(path:string,input:unknown)=>{const response=await fetch(server.url+"/api/v1"+path,{method:"POST",headers:{Authorization:"Bearer "+server.credentials().reporterToken,"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify(input)});expect(response.status).toBe(201);return(await response.json()).data.id as string;};
 const projectId=await create("/projects",{name:"Synthetic known bindings"}),parentTaskId=await create("/tasks",{projectId,title:"Synthetic parent"}),assignedAgentId=await create("/agents",{displayName:"Synthetic",source:"W01",defaultRole:"implementation"});
 const proxy=await publicProxy(server,(req,_bytes,reply)=>{
  if(!reply||req.url!=="/api/v1/tasks"||req.method!=="POST")return;
  expect(req.headers.prefer).toBe("return=minimal");const full=JSON.parse(reply.body.toString()),task=full.data;
  const data={kind:"task",id:task.id.toLowerCase(),projectId:task.projectId.toLowerCase(),parentTaskId:task.parentTaskId?.toLowerCase()??null,assignedAgentId:task.assignedAgentId?.toLowerCase()??null,version:task.version,workRevision:task.workRevision};
  const altered=wrong?control==="wrong-kind"?{kind:"workflow"}:control==="invalid-id"?{id:"not-a-uuid"}:control==="wrong-project"?{projectId:randomUUID()}:control==="wrong-parent"?{parentTaskId:randomUUID()}:control==="wrong-agent"?{assignedAgentId:randomUUID()}:control==="wrong-version"?{version:2}:control==="unknown-field"?{unknown:true}:{}:{};
  return{status:reply.status,headers:{"AgentFlow-Generation":reply.generation!,...(wrong&&control==="missing-applied"?{}:{"Preference-Applied":"return=minimal"})},body:wrong&&control==="oversized"?"x".repeat(65537):JSON.stringify({...full,data:{...data,...altered}})};
 });
 try{
  const f=cliFixture({...server,port:proxy.port}),body={projectId:projectId.toUpperCase(),parentTaskId:parentTaskId.toUpperCase(),assignedAgentId:assignedAgentId.toUpperCase(),title:"Synthetic bound acknowledgement"},key=randomUUID();
  const blocked=await f.cli(["task","create","--file",f.file(body),"--idempotency-key",key]);expect(blocked.code).toBe(3);const path=join(f.env.AGENTFLOW_OUTBOX_DIR,`registration-${key}.json`),bytes=readFileSync(path);expect(JSON.parse(bytes.toString()).body).toEqual(body);wrong=false;
  const replay=await f.cli(["flush"]);expect(replay.code).toBe(0);expect(readdirSync(f.env.AGENTFLOW_OUTBOX_DIR).filter(n=>n.startsWith("registration-"))).toEqual([]);expect(JSON.parse(replay.stdout).id).toMatch(/^[a-f0-9-]{36}$/);
 }finally{await proxy.close();await server.stop();}
});
it("replays a lost compact task acknowledgement and supports strict legacy full fallback",async()=>{
 const server=await launch();let drop=true,legacy=false;
 const fullReplies:{status:number;raw:string;applied:string|null;key:string;input:unknown;originalId:string}[]=[];
 const proxy=await publicProxy(server,async(req,bytes,reply):Promise<Awaited<ReturnType<Parameters<typeof publicProxy>[1]>>>=>{
  if(!reply||req.url!=="/api/v1/tasks"||req.method!=="POST")return;
  if(drop)return{drop:true};if(legacy){
   expect(req.headers.prefer).toBe("return=minimal");
   const response=await fetch(server.url+req.url,{method:"POST",headers:{Authorization:String(req.headers.authorization),"Content-Type":"application/json","Idempotency-Key":String(req.headers["idempotency-key"])},body:bytes.toString()});
   const raw=await response.text(),applied=response.headers.get("Preference-Applied");
   fullReplies.push({status:response.status,raw,applied,key:String(req.headers["idempotency-key"]),input:JSON.parse(bytes.toString()),originalId:JSON.parse(reply.body.toString()).data.id});
   return{status:response.status,headers:{"AgentFlow-Generation":response.headers.get("AgentFlow-Generation")!},body:raw};
  }
  const full=JSON.parse(reply.body.toString()),task=full.data;return{status:reply.status,headers:{"AgentFlow-Generation":reply.generation!,"Preference-Applied":"return=minimal"},body:JSON.stringify({...full,data:{kind:"task",id:task.id,projectId:task.projectId,parentTaskId:task.parentTaskId,assignedAgentId:task.assignedAgentId,version:1,workRevision:1}})};
 });
 try{
  const f=cliFixture({...server,port:proxy.port}),p=await f.cli(["project","create","--file",f.file({name:"Synthetic lost compact reply"}),"--idempotency-key",randomUUID()]);expect(p.code).toBe(0);const projectId=JSON.parse(p.stdout).id,key=randomUUID(),body={projectId,title:"Original lost task"};expect((await f.cli(["task","create","--file",f.file(body),"--idempotency-key",key])).code).toBe(2);
  const path=join(f.env.AGENTFLOW_OUTBOX_DIR,`registration-${key}.json`),bytes=readFileSync(path);expect(JSON.parse(bytes.toString()).body).toEqual(body);drop=false;expect((await f.cli(["flush"])).code).toBe(0);
  legacy=true;const legacyKey=randomUUID(),legacyBody={projectId,title:"Legacy full fallback"};
  const result=await f.cli(["task","create","--file",f.file(legacyBody),"--idempotency-key",legacyKey]);expect(result.code).toBe(0);
  expect(fullReplies).toHaveLength(1);expect(fullReplies[0]).toMatchObject({status:201,applied:null,key:legacyKey,input:legacyBody});
  const full=JSON.parse(fullReplies[0].raw);expect(taskResponse.safeParse(full).success).toBe(true);expect(taskRegistrationResponse.safeParse(full).success).toBe(false);
  expect(full.data).toMatchObject({...legacyBody,parentTaskId:null,assignedAgentId:null,version:1,workRevision:1});expect(full.data.id).toBe(fullReplies[0].originalId);expect(JSON.parse(result.stdout).id).toBe(full.data.id);
  expect(readdirSync(f.env.AGENTFLOW_OUTBOX_DIR).filter(n=>n.startsWith("registration-"))).toEqual([]);
 }finally{await proxy.close();await server.stop();}
},30000);
