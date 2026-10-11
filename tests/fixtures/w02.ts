import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOwnedStore } from "../../src/db";
import type { ApplicationCommand } from "../../src/db/application";
import { canonicalDigest } from "../../src/domain/request-digest";
import { task, taskDetailQueryV1 } from "../../src/contracts/tasks";
import { eventInput } from "../../src/contracts/observations";
export async function evidenceFixture() {
  const owned = await openOwnedStore(mkdtempSync(join(realpathSync(tmpdir()),"w02-")));
  let now = Date.now();
  const send = (command: ApplicationCommand, key = randomUUID(), principal: "operator" | "reporter" = "operator") => owned.store.command(command,{principal,method:"POST",path:command.kind,key,digest:canonicalDigest(command),now:++now});
  const projectId = (send({kind:"project.create",input:{name:"Synthetic W02"}}).body.data as {id:string}).id;
  const agentId = (send({kind:"agent.create",input:{displayName:"Synthetic",source:"fixture",defaultRole:"implementation"}}).body.data as {id:string}).id;
  const create = () => (send({kind:"task.create",input:{projectId,title:"Synthetic task"}}).body.data as {id:string}).id;
  const detail = (id:string) => owned.store.snapshot({kind:"task",id,input:taskDetailQueryV1.parse({})}).body.data as {task:unknown};
  const current = (id:string) => task.parse(detail(id).task);
  const move = (id:string,status:"backlog"|"review"|"in_progress") => send({kind:"task.patch",id,input:{expectedVersion:current(id).version,status}});
  const artifact = (id:string,artifactRef:string) => send({kind:"task.artifact",id,input:{expectedVersion:current(id).version,artifactRef}});
  const policy = (id:string,reviewRequired=true,verificationRequired=false) => send({kind:"task.review-policy",id,input:{expectedVersion:current(id).version,reviewRequired,verificationRequired}});
  const complete = (id:string) => send({kind:"task.complete",id,input:{expectedVersion:current(id).version,evidenceNote:"Synthetic browser-role acceptance"}});
  const reopen = (id:string) => send({kind:"task.reopen",id,input:{expectedVersion:current(id).version,reason:"Synthetic reopen"}});
  const register = (id:string,purpose:"implementation"|"review"|"verification",tuple?:{workRevision:number;artifactRef:string;reworkRound:number}) => {
    const runId=randomUUID();send({kind:"run.register",input:{id:runId,projectId,agentId,taskId:id,purpose,expectedTaskVersion:current(id).version,...tuple}});return runId;
  };
  const report = (runId:string,sequence:number,type:string,payload:unknown={}) => send({kind:"run.event",id:runId,input:eventInput.parse({schemaVersion:1,eventId:randomUUID(),runId,sequence,occurredAt:new Date(now).toISOString(),type,payload})});
  const succeed = (id:string,artifactRef="synthetic:A") => {const runId=register(id,"implementation");report(runId,1,"run.started");report(runId,2,"run.succeeded",{summary:"done",artifactRef});return runId;};
  const gate = (id:string,purpose:"review"|"verification",decision:"approved"|"changes_requested",artifactRef="synthetic:A") => {const t=current(id);const runId=register(id,purpose,{workRevision:t.workRevision,artifactRef,reworkRound:t.reworkRound});report(runId,1,"run.started");report(runId,2,"run.succeeded",{summary:"reviewed",decision,evidenceNote:"Synthetic evidence"});return runId;};
  return {owned,send,projectId,agentId,create,current,detail,move,artifact,policy,complete,reopen,register,report,succeed,gate};
}
