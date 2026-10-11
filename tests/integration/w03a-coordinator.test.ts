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
it("preserves Retry-After across saves, disconnect and scope replacement while replay and expiry remain usable",async()=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),"w03a-rate-settings-")),file=join(dir,"token.json");writeFileSync(file,JSON.stringify({token:"SYNTHETIC"}),{mode:0o600});
 const owned=await openOwnedStore(join(dir,"data"));let calls=0;
 const server=createServer((_req,res)=>{calls++;if(calls===1){res.writeHead(429,{"Retry-After":"60"});res.end();}else res.end("[]");});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const port=(server.address() as {port:number}).port,transport:typeof fetch=(url,init)=>fetch(String(url).replace("https://api.github.com",`http://127.0.0.1:${port}`),init),coordinator=new GithubCoordinator(owned.store,file,transport);
 try{
  const save=(expectedVersion:number,enabled:boolean,repositories:string[])=>{const input={expectedVersion,enabled,repositories};return coordinator.repositories(input,{...context(input),method:"PUT",path:"/api/v1/connections/github/repositories"});};
  save(1,true,["a/b"]);const request={expectedVersion:2,repository:"a/b",page:1} as const,c=context(request),receipt=await coordinator.refresh(request,c);
  expect(receipt.body.data).toMatchObject({outcome:"failed",error:"rate_limited"});expect(calls).toBe(1);
  const connection=()=> (coordinator.snapshot({limit:1}).body.data as {connection:{retryNotBefore:string|null}}).connection;
  const deadline=connection().retryNotBefore!;expect(Date.parse(deadline)).toBeGreaterThan(c.now);
  const blocked=async(version:number,repository="a/b")=>{const input={expectedVersion:version,repository,page:1} as const;await expect(coordinator.refresh(input,{...context(input),now:c.now+1})).rejects.toThrow("github_rate_limited");expect(connection().retryNotBefore).toBe(deadline);expect(calls).toBe(1);expect(await coordinator.refresh(request,c)).toEqual(receipt);};
  save(2,true,["a/b"]);await blocked(3);
  save(3,false,[]);expect(await coordinator.refresh(request,c)).toEqual(receipt);expect(connection().retryNotBefore).toBe(deadline);
  save(4,true,["a/b"]);await blocked(5);
  save(5,true,["c/d"]);await blocked(6,"c/d");
  const expired={expectedVersion:6,repository:"c/d",page:1} as const;expect((await coordinator.refresh(expired,{...context(expired),now:Date.parse(deadline)+1})).body.data).toMatchObject({outcome:"fetched"});expect(calls).toBe(2);expect(connection().retryNotBefore).toBeNull();expect(await coordinator.refresh(request,c)).toEqual(receipt);expect(calls).toBe(2);
 }finally{await coordinator.close();await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});owned.close();}
});
