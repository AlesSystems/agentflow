import { randomUUID } from "node:crypto";
import { readFileSync,readdirSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";
import { openOutbox } from "../../src/cli/outbox";
it("rejects online dataLocation change before any outbox mutation and keeps private paths out of streams",async()=> {
  const server=await launch();let changed=false;
  const proxy=await publicProxy(server,(req,_body,reply)=>{if(changed&&reply&&req.url==="/api/v1/settings"){const value=JSON.parse(reply.body.toString());value.data.dataLocation=join(server.dir,"PRIVATE-P06-DESTINATION");return{status:200,body:JSON.stringify(value),headers:{"AgentFlow-Generation":reply.generation!}};}});
  try{const f=await registeredRun({...server,port:proxy.port}),root=f.env.AGENTFLOW_OUTBOX_DIR,metadata=readFileSync(join(root,"metadata.json")),state=readFileSync(join(root,f.runId,"state.json"));changed=true;const result=await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})]);expect(result.code).toBe(1);expect(result.stderr).toContain("destination_mismatch");expect(result.stderr).not.toContain("PRIVATE-P06");expect(result.stderr).not.toContain(server.dir);expect(readFileSync(join(root,"metadata.json"))).toEqual(metadata);expect(readFileSync(join(root,f.runId,"state.json"))).toEqual(state);expect(readdirSync(join(root,f.runId))).toEqual(["state.json"]);}finally{await proxy.close();await server.stop();}
});
it("reporter cannot pair, complete, reopen, close or open the browser change stream while queued observations remain intact",async()=> {
  const server=await launch();
  try {
    const f=await registeredRun(server),task=await f.cli(["task","create","--file",f.file({projectId:f.projectId,title:"Synthetic authority"}),"--idempotency-key",randomUUID()]);expect(task.code).toBe(0);const taskId=JSON.parse(task.stdout).id;
    const root=f.env.AGENTFLOW_OUTBOX_DIR,box=await openOutbox({port:server.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined},performance.now()+5000);try{await box.enqueue(f.runId,"run.started",{});}finally{box.close();}
    const directory=join(root,f.runId),name=readdirSync(directory).find(name=>/^1-/.test(name))!,original=readFileSync(join(directory,name)),state=readFileSync(join(directory,"state.json"));
    const headers={Authorization:`Bearer ${server.credentials().reporterToken}`,Origin:server.url,"Content-Type":"application/json","Idempotency-Key":randomUUID()};
    expect((await fetch(server.url+"/api/v1/session",{method:"POST",headers,body:JSON.stringify({token:server.credentials().reporterToken})})).status).toBe(403);
    for(const path of [`/tasks/${taskId}/complete`,`/tasks/${taskId}/reopen`,`/runs/${f.runId}/close`])expect((await fetch(server.url+"/api/v1"+path,{method:"POST",headers,body:JSON.stringify({expectedVersion:1,reason:"Synthetic"})})).status).toBe(403);
    const stream=await fetch(server.url+"/api/v1/changes/stream",{headers:{Authorization:headers.Authorization}});expect(stream.status).toBe(403);expect(await stream.text()).not.toContain("repositoryPath");
    expect(readFileSync(join(directory,name))).toEqual(original);expect(readFileSync(join(directory,"state.json"))).toEqual(state);
    for(const command of ["pair","complete","reopen","close"]){const result=await f.cli([command]);expect(result.code).toBe(1);expect(result.stdout).toBe("");}
  }finally{await server.stop();}
});
it("keeps a stale run registration original and reports currentVersion without private response fields",async()=> {
  const server=await launch();
  try {
    const f=await registeredRun(server),task=await f.cli(["task","create","--file",f.file({projectId:f.projectId,title:"Synthetic version"}),"--idempotency-key",randomUUID()]);expect(task.code).toBe(0);const taskId=JSON.parse(task.stdout).id,id=randomUUID(),key=randomUUID(),body={id,projectId:f.projectId,agentId:f.agentId,taskId,purpose:"implementation",expectedTaskVersion:2};
    const result=await f.cli(["run","register","--file",f.file(body),"--idempotency-key",key]);expect(result.code).toBe(3);expect(result.stderr).toContain('"currentVersion":1');expect(result.stderr).toContain(id);expect(result.stdout).toBe("");
    expect(JSON.parse(readFileSync(join(f.env.AGENTFLOW_OUTBOX_DIR,`registration-${key}.json`),"utf8")).body).toEqual(body);
  }finally{await server.stop();}
});
