import { createServer } from "node:http";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { expect,it } from "vitest";
import { openOwnedStore } from "../../src/db";
import { GithubCoordinator } from "../../src/integrations/github/coordinator";
import { canonicalDigest } from "../../src/domain/request-digest";
import type { CommandContext } from "../../src/db/application";
const context=(input:unknown,key=randomUUID()):CommandContext=>({principal:"operator",method:"POST",path:"/api/v1/connections/github/refresh",key,digest:canonicalDigest(input),now:Date.now()});
it("shares admitted work, rejects conflicting/busy commands, preserves lost replies and drains cancellations",async()=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),"w03a-coordinate-"));const file=join(dir,"token.json");writeFileSync(file,JSON.stringify({token:"SYNTHETIC"}),{mode:0o600});
 const owned=await openOwnedStore(join(dir,"data"));let calls=0;let release=()=>{};let entered=()=>{};const observed=new Promise<void>(resolve=>{entered=resolve;});
 const server=createServer(async(req,res)=>{calls++;entered();await new Promise<void>(resolve=>{release=resolve;});res.end(JSON.stringify([]));});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const port=(server.address() as {port:number}).port;const transport:typeof fetch=(url,init)=>fetch(String(url).replace("https://api.github.com",`http://127.0.0.1:${port}`),init);
 const coordinator=new GithubCoordinator(owned.store,file,transport);
 try{
  const input={expectedVersion:1,repository:"a/b",page:1} as const;
  await expect(coordinator.refresh(input,context(input))).rejects.toThrow("github_disabled");expect(calls).toBe(0);
  coordinator.repositories({expectedVersion:1,enabled:true,repositories:["a/b"]},context({enabled:true}));
  const request={...input,expectedVersion:2};const c=context(request);const first=coordinator.refresh(request,c);await observed;
  const same=coordinator.refresh(request,c);await expect(coordinator.refresh(request,{...c,digest:"changed"})).rejects.toThrow("idempotency_conflict");await expect(coordinator.refresh(request,context(request))).rejects.toThrow("github_busy");
  release();const result=await first;expect(await same).toEqual(result);expect(await coordinator.refresh(request,c)).toEqual(result);expect(calls).toBe(1);
  const second=coordinator.refresh(request,context(request));await new Promise(resolve=>setTimeout(resolve,20));coordinator.repositories({expectedVersion:2,enabled:false,repositories:[]},context({disabled:true}));expect((await second).body.data).toMatchObject({outcome:"superseded"});
  await coordinator.close();await expect(coordinator.refresh(request,context(request))).rejects.toThrow("unavailable");
 }finally{release();await coordinator.close();await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});owned.close();}
});
it("startup records interrupted receipts without outbound retry",async()=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),"w03a-recover-"));let owned=await openOwnedStore(dir);
 const input={expectedVersion:1,enabled:true,repositories:["a/b"]};owned.store.githubRepositories(input,context(input));
 const request={expectedVersion:2,repository:"a/b",number:9} as const;const c=context(request);owned.store.githubAdmit(request,c,false);owned.close();owned=await openOwnedStore(dir);let calls=0;
 const coordinator=new GithubCoordinator(owned.store,undefined,async()=>{calls++;throw Error("unexpected");});
 try{expect((await coordinator.refresh(request,c)).body.data).toMatchObject({outcome:"interrupted",error:"interrupted"});expect(calls).toBe(0);}finally{await coordinator.close();owned.close();}
});
