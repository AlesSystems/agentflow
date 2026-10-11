import { randomUUID } from "node:crypto";
import { registeredRun } from "./p06-cli";
import type { launch } from "./server";
export async function workflowCliFixture(server: Awaited<ReturnType<typeof launch>>) {
 const f=await registeredRun(server);
 const register=async(args:string[],body:unknown)=>{const r=await f.cli([...args,"--file",f.file(body),"--idempotency-key",randomUUID()]);if(r.code!==0)throw new Error("workflow fixture registration failed "+r.stderr);return JSON.parse(r.stdout).id as string;};
 const workflowId=await register(["register","workflow"],{id:randomUUID(),projectId:f.projectId,name:"Synthetic workflow producer"});
 const nodeId=randomUUID(),revisionId=await register(["register","workflow-revision","--workflow",workflowId],{id:randomUUID(),expectedWorkflowVersion:1,nodes:[{id:nodeId,label:"Synthetic node"}],edges:[]});
 await register(["register","workflow-run"],{id:f.runId,workflowId,planRevisionId:revisionId});
 return {...f,workflowId,revisionId,nodeId,workflowRunId:f.runId,ref:{kind:"workflow-run" as const,id:f.runId},config:{port:server.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined}};
}
