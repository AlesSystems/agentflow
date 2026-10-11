import { randomUUID } from "node:crypto";
import { readFileSync,readdirSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch,pair } from "../fixtures/server";
import { cliFixture } from "../fixtures/p06-cli";
import { canonicalDigest } from "../../src/domain/request-digest";
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

it("retains blocked dependency and missing or obsolete tuple registrations with specific repair diagnostics",async()=>{
 const server=await launch(),cookie=await pair(server);const rows:unknown[]=[];
 const call=async(path:string,input:unknown,method="POST",human=false)=>{const r=await fetch(server.url+"/api/v1"+path,{method,headers:{...(human?{Cookie:cookie,Origin:server.url}:{Authorization:"Bearer "+server.credentials().reporterToken}),"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify(input)});expect(r.ok).toBe(true);return (await r.json()).data;};
 const Database=(await import("better-sqlite3")).default;
 const inspect=()=>{const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{return Object.fromEntries(["runs","run_registrations","receipts","changes"].map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()]));}finally{db.close();}};
 try{
  const p=await call("/projects",{name:"Synthetic registration rejection"}),a=await call("/agents",{displayName:"Synthetic",source:"CLI",defaultRole:"implementation"});
  const prerequisite=await call("/tasks",{projectId:p.id,title:"Unaccepted prerequisite"}),dependent=await call("/tasks",{projectId:p.id,title:"Blocked implementation"});
  await call("/tasks/"+dependent.id+"/dependencies",{expectedVersion:1,prerequisiteIds:[prerequisite.id]},"PUT",true);
  const gate=await call("/tasks",{projectId:p.id,title:"Required tuple"});await call("/tasks/"+gate.id+"/review-policy",{expectedVersion:1,reviewRequired:true,verificationRequired:false},"PATCH",true);await call("/tasks/"+gate.id+"/artifact",{expectedVersion:2,artifactRef:"synthetic:current"},"POST",true);
  const common={projectId:p.id,agentId:a.id};
  for(const [code,body,repair] of [
   ["dependencies_not_ready",{...common,id:randomUUID(),taskId:dependent.id,purpose:"implementation",expectedTaskVersion:2},"prerequisite"],
   ["review_tuple_required",{...common,id:randomUUID(),taskId:gate.id,purpose:"review",expectedTaskVersion:3},"current work revision"],
   ["review_tuple_obsolete",{...common,id:randomUUID(),taskId:gate.id,purpose:"review",expectedTaskVersion:3,workRevision:1,artifactRef:"synthetic:obsolete",reworkRound:0},"obsolete"],
  ] as const){
   const f=cliFixture(server),key=randomUUID(),before=inspect();
   const result=await f.cli(["run","register","--file",f.file(body),"--idempotency-key",key]);expect(result.code).toBe(3);expect(JSON.parse(result.stderr)).toMatchObject({code,repair:expect.stringContaining(repair)});expect(inspect()).toEqual(before);
   const filename=join(f.env.AGENTFLOW_OUTBOX_DIR,`registration-${key}.json`),original=readFileSync(filename,"utf8"),record=JSON.parse(original);
   expect(record).toMatchObject({key,path:"/runs",body,digest:canonicalDigest(body)});
   const flush=await f.cli(["flush"]);expect(flush.code).toBe(3);expect(JSON.parse(flush.stderr).code).toBe(code);expect(readFileSync(filename,"utf8")).toBe(original);expect(inspect()).toEqual(before);rows.push({code,key,result,flush,original,before,after:inspect()});
  }
 }finally{if(process.env.AGENTFLOW_W02_EVIDENCE_DIR)writeFileSync(join(process.env.AGENTFLOW_W02_EVIDENCE_DIR,"cli-registration-rejections.json"),JSON.stringify({dir:server.dir,rows},null,2),{mode:0o600});await server.stop();}
});
