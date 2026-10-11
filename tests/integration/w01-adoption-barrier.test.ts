import { randomUUID } from "node:crypto";
import { readFileSync,existsSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { openOutbox } from "../../src/cli/outbox";
import { createFile,syncDirectory } from "../../src/server/filesystem";
it("requires namespace durability before delivering remote workflow adoption and safely retries a failed barrier",async()=>{
 const server=await launch(),f=await registeredRun(server);
 try{
  const create=async(path:string,body:unknown)=>{const r=await fetch(server.url+"/api/v1"+path,{method:"POST",headers:{Authorization:"Bearer "+server.credentials().reporterToken,"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify(body)});expect(r.status).toBe(201);return(await r.json()).data.id as string;};
  const workflowId=await create("/workflows",{id:randomUUID(),projectId:f.projectId,name:"Synthetic remote adoption"}),revisionId=await create(`/workflows/${workflowId}/revisions`,{id:randomUUID(),expectedWorkflowVersion:1,nodes:[{id:randomUUID(),label:"Node"}],edges:[]});await create("/workflow-runs",{id:f.runId,workflowId,planRevisionId:revisionId});
  const config={port:server.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined},namespace=join(config.outbox,"workflow-runs"),leaf=join(namespace,f.runId),taskState=readFileSync(join(config.outbox,f.runId,"state.json")),order:string[]=[];let fail=true;
  const outbox=await openOutbox(config,performance.now()+5000,{syncDirectory(path){if(path===namespace){order.push("namespace");if(fail)throw new Error("synthetic namespace barrier failure");}else if(path===config.outbox)order.push("root");else if(path===leaf)order.push("leaf");syncDirectory(path);},createFile(path,body){if(path===join(leaf,"state.json.tmp"))order.push("state");createFile(path,body);}});
  try{order.length=0;await expect(outbox.initializeRun({kind:"workflow-run",id:f.runId})).rejects.toThrow("synthetic namespace barrier failure");expect(existsSync(join(leaf,"state.json"))).toBe(false);expect(readFileSync(join(config.outbox,f.runId,"state.json"))).toEqual(taskState);fail=false;order.length=0;expect((await outbox.initializeRun({kind:"workflow-run",id:f.runId})).kind).toBe("delivered");expect(order.slice(0,4)).toEqual(["namespace","root","state","leaf"]);expect(JSON.parse(readFileSync(join(leaf,"state.json"),"utf8"))).toMatchObject({producerKind:"workflow-run",allocatedThrough:0,acknowledgedThrough:0});}finally{outbox.close();}
 }finally{await server.stop();}
});
