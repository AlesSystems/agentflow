import { randomUUID } from "node:crypto";
import { readFileSync,readdirSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch,pair } from "../fixtures/server";
import { cliFixture } from "../fixtures/p06-cli";
it("keeps rejected gate bytes pending and prints an allowlisted actionable decision diagnostic",async()=>{
 const server=await launch();const f=cliFixture(server),cookie=await pair(server);
 const call=async(path:string,input:unknown,method="POST",human=false)=>{const r=await fetch(server.url+"/api/v1"+path,{method,headers:{...(human?{Cookie:cookie,Origin:server.url}:{Authorization:"Bearer "+server.credentials().reporterToken}),"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify(input)});expect(r.ok).toBe(true);return (await r.json()).data;};
 try{
  const p=await call("/projects",{name:"Synthetic rejection"}),a=await call("/agents",{displayName:"Synthetic",source:"CLI",defaultRole:"reviewer"}),t=await call("/tasks",{projectId:p.id,title:"Required gate"});
  await call("/tasks/"+t.id+"/review-policy",{expectedVersion:1,reviewRequired:true,verificationRequired:false},"PATCH",true);await call("/tasks/"+t.id+"/artifact",{expectedVersion:2,artifactRef:"synthetic:rejected"},"POST",true);
  const id=randomUUID(),registration=await f.cli(["run","register","--file",f.file({id,projectId:p.id,agentId:a.id,taskId:t.id,purpose:"review",expectedTaskVersion:3,workRevision:1,artifactRef:"synthetic:rejected",reworkRound:0}),"--idempotency-key",randomUUID()]);expect(registration.code).toBe(0);
  expect((await f.cli(["report","--run",id,"--type","run.started","--payload",f.file({})])).code).toBe(0);
  const result=await f.cli(["report","--run",id,"--type","run.succeeded","--payload",f.file({summary:"no decision"})]);expect(result.code).toBe(3);expect(JSON.parse(result.stderr)).toMatchObject({code:"decision_required",repair:expect.stringContaining("explicit decision")});
  const directory=join(f.env.AGENTFLOW_OUTBOX_DIR,id),name=readdirSync(directory).find(n=>/^2-/.test(n))!,original=readFileSync(join(directory,name),"utf8");
  expect((await f.cli(["flush","--run",id])).code).toBe(3);expect(readFileSync(join(directory,name),"utf8")).toBe(original);
 }finally{await server.stop();}
});
