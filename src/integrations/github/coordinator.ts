import type { Store } from "../../db";
import type { CommandContext, CommittedReply } from "../../db/application";
import type { GithubQuery, GithubRefreshInput, GithubRepositoriesInput } from "../../contracts/github";
import { Conflict } from "../../domain/tasks";
import { GithubAdapter } from "./adapter";
export class GithubCoordinator {
 private adapter:GithubAdapter;
 private active:{key:string;version:number;promise:Promise<CommittedReply>;controller:AbortController}|undefined;
 private closing=false;
 constructor(private store:Store,credentialPath?:string,transport?:typeof fetch){
  this.adapter=new GithubAdapter(credentialPath,transport);store.githubRecover();
 }
 snapshot(input:GithubQuery,now=Date.now()){
  const reply=this.store.githubSnapshot(input,now,this.adapter.credentialState(),!!this.active);
  return reply;
 }
 repositories(input:GithubRepositoriesInput,context:CommandContext){
  if(this.closing)throw new Conflict("unavailable");
  const reply=this.store.githubRepositories(input,context);
  const current=this.store.githubSnapshot({limit:1}).body.data as {connection:{version:number}};
  if(this.active && current.connection.version!==this.active.version)this.active.controller.abort();return reply;
 }
 async refresh(input:GithubRefreshInput,context:CommandContext):Promise<CommittedReply>{
  if(this.closing)throw new Conflict("unavailable");
  const admitted=this.store.githubAdmit(input,context,!!this.active);
  if(admitted.kind==="replay")return admitted.reply;
  const key=JSON.stringify([context.principal,context.method,context.path,context.key]);
  if(admitted.kind==="pending"){
   if(this.active?.key===key)return this.active.promise;
   throw new Conflict("github_busy");
  }
  const controller=new AbortController();
  const promise=this.adapter.observe(admitted.intent.request,controller.signal).then(outcome=>this.store.githubFinalize(admitted.intent,outcome,Date.now())).finally(()=>{if(this.active?.key===key)this.active=undefined;});
  this.active={key,version:admitted.intent.connectionVersion,promise,controller};return promise;
 }
 beginClosing(){this.closing=true;this.active?.controller.abort();}
 async close(){this.beginClosing();if(this.active)await this.active.promise;}
}
