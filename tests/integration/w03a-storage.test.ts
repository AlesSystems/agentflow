import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { openOwnedStore } from "../../src/db";
import { canonicalDigest } from "../../src/domain/request-digest";
import type { CommandContext } from "../../src/db/application";
const context = (input:unknown,key=randomUUID(),principal:CommandContext["principal"]="operator"):CommandContext => ({principal,method:"POST",path:"/api/v1/connections/github/refresh",key,digest:canonicalDigest(input),now:Date.now()});
it("defaults disabled, isolates versions, authorizes before replay and keeps completed original receipts",async()=>{
 const owned=await openOwnedStore(mkdtempSync(join(realpathSync(tmpdir()),"w03a-store-")));
 try {
  expect(owned.store.githubSnapshot({limit:20}).body.data).toMatchObject({connection:{enabled:false,repositories:[],version:1},items:[]});
  const input={expectedVersion:1,enabled:true,repositories:["a/b"]}; const c=context(input);
  const configured=owned.store.githubRepositories(input,c);
  expect(owned.store.githubRepositories(input,c)).toEqual(configured);
  expect(()=>owned.store.githubRepositories(input,{...c,principal:"reporter"})).toThrow("human_required");
  expect(owned.store.snapshot({kind:"settings"}).body.data).toMatchObject({version:1});
  const request={expectedVersion:2,repository:"a/b",number:9} as const; const r=context(request);
  const admitted=owned.store.githubAdmit(request,r,false);
  expect(admitted.kind).toBe("admitted");
  if(admitted.kind!=="admitted") throw Error("not admitted");
  const reply=owned.store.githubFinalize(admitted.intent,{outcome:"failed",error:"inaccessible",retryNotBefore:null,items:[],nextPage:null},Date.now());
  expect(reply.body.data).toMatchObject({outcome:"failed",error:"inaccessible"});
  expect(owned.store.githubSnapshot({limit:20,repository:"a/b",number:9}).body.data).toMatchObject({lookupAttempt:{error:"inaccessible"},items:[]});
  owned.store.githubRepositories({expectedVersion:2,enabled:false,repositories:[]},context({disable:true}));
  expect(owned.store.githubAdmit(request,r,true)).toEqual({kind:"replay",reply});
  expect(()=>owned.store.githubAdmit(request,{...r,digest:"changed"},true)).toThrow("idempotency_conflict");
 }finally{owned.close();}
});
it("does not consume busy keys and supersedes old observations after configuration changes",async()=>{
 const owned=await openOwnedStore(mkdtempSync(join(realpathSync(tmpdir()),"w03a-cas-")));
 try {
  owned.store.githubRepositories({expectedVersion:1,enabled:true,repositories:["a/b"]},context({enable:true}));
  const request={expectedVersion:2,repository:"a/b",page:1} as const;const c=context(request);
  expect(()=>owned.store.githubAdmit(request,c,true)).toThrow("github_busy");
  const admitted=owned.store.githubAdmit(request,c,false);if(admitted.kind!=="admitted")throw Error("not admitted");
  owned.store.githubRepositories({expectedVersion:2,enabled:false,repositories:[]},context({disable:true}));
  expect(owned.store.githubFinalize(admitted.intent,{outcome:"failed",error:"offline",retryNotBefore:null,items:[],nextPage:null},Date.now()).body.data).toMatchObject({outcome:"superseded",error:null});
  expect(owned.store.githubSnapshot({limit:20}).body.data).toMatchObject({connection:{lastError:null}});
 }finally{owned.close();}
});
it("preserves prior projected observations on failure, list absence and disconnect, and never changes task facts",async()=>{
 const owned=await openOwnedStore(mkdtempSync(join(realpathSync(tmpdir()),"w03a-observations-")));
 try{
  owned.store.githubRepositories({expectedVersion:1,enabled:true,repositories:["a/b"]},context({enable:true}));
  const refresh=(input:{expectedVersion:2;repository:"a/b";number:9},head:string)=>{
   const admitted=owned.store.githubAdmit(input,context({...input,head}),false);if(admitted.kind!=="admitted")throw Error("not admitted");
   return owned.store.githubFinalize(admitted.intent,{outcome:"fetched",error:null,retryNotBefore:null,nextPage:null,items:[{repository:"a/b",number:9,url:"https://github.com/a/b/pull/9",title:"Synthetic",state:"open",draft:false,headSha:head,baseBranch:"main",mergedAt:null}]},Date.now());
  };
  const input={expectedVersion:2,repository:"a/b",number:9} as const;refresh(input,"a".repeat(40));refresh(input,"b".repeat(40));
  expect(owned.store.githubSnapshot({limit:20}).body.data).toMatchObject({items:[{headSha:"b".repeat(40),previousHeadSha:"a".repeat(40),headChanged:true}]});
  const failed=owned.store.githubAdmit(input,context({failed:true}),false);if(failed.kind!=="admitted")throw Error();owned.store.githubFinalize(failed.intent,{outcome:"failed",error:"inaccessible",retryNotBefore:null,nextPage:null,items:[]},Date.now());
  expect(owned.store.githubSnapshot({limit:20}).body.data).toMatchObject({items:[{title:"Synthetic",headSha:"b".repeat(40),lastError:"inaccessible",stale:true}]});
  const list={expectedVersion:2,repository:"a/b",page:1} as const;const absent=owned.store.githubAdmit(list,context(list),false);if(absent.kind!=="admitted")throw Error();owned.store.githubFinalize(absent.intent,{outcome:"fetched",error:null,retryNotBefore:null,nextPage:null,items:[]},Date.now());
  expect(owned.store.githubSnapshot({limit:20}).body.data).toMatchObject({total:1});
  owned.store.githubRepositories({expectedVersion:2,enabled:false,repositories:[]},context({disable:true}));expect(owned.store.githubSnapshot({limit:20}).body.data).toMatchObject({items:[{stale:true}]});
  expect(owned.store.snapshot({kind:"tasks",input:{limit:20}}).body.data).toMatchObject({total:0});
 }finally{owned.close();}
});
