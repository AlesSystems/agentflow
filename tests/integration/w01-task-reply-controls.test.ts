import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { cliFixture } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";
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
 const proxy=await publicProxy(server,(req,_bytes,reply)=>{
  if(!reply||req.url!=="/api/v1/tasks"||req.method!=="POST")return;
  if(drop)return{drop:true};if(legacy)return;
  const full=JSON.parse(reply.body.toString()),task=full.data;return{status:reply.status,headers:{"AgentFlow-Generation":reply.generation!,"Preference-Applied":"return=minimal"},body:JSON.stringify({...full,data:{kind:"task",id:task.id,projectId:task.projectId,parentTaskId:task.parentTaskId,assignedAgentId:task.assignedAgentId,version:1,workRevision:1}})};
 });
 try{
  const f=cliFixture({...server,port:proxy.port}),p=await f.cli(["project","create","--file",f.file({name:"Synthetic lost compact reply"}),"--idempotency-key",randomUUID()]);expect(p.code).toBe(0);const projectId=JSON.parse(p.stdout).id,key=randomUUID(),body={projectId,title:"Original lost task"};expect((await f.cli(["task","create","--file",f.file(body),"--idempotency-key",key])).code).toBe(2);
  const path=join(f.env.AGENTFLOW_OUTBOX_DIR,`registration-${key}.json`),bytes=readFileSync(path);expect(JSON.parse(bytes.toString()).body).toEqual(body);drop=false;expect((await f.cli(["flush"])).code).toBe(0);
  legacy=true;expect((await f.cli(["task","create","--file",f.file({projectId,title:"Legacy full fallback"}),"--idempotency-key",randomUUID()])).code).toBe(0);
 }finally{await proxy.close();await server.stop();}
},30000);
