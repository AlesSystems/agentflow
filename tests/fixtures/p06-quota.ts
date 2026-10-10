import { randomUUID } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalDigest } from "../../src/domain/request-digest";
export const RUN_BYTES=10*1024*1024, GLOBAL_BYTES=100*1024*1024;
export function logicalBytes(directory: string): number {
  return readdirSync(directory).reduce((sum,name)=> {
    const path=join(directory,name),stat=lstatSync(path);
    return sum+(stat.isDirectory()?logicalBytes(path):stat.size);
  },0);
}
export function seedRunToBytes(root: string,id: string,target: number) {
  const directory=join(root,id),path=join(directory,"state.json");
  const original=JSON.parse(readFileSync(path,"utf8"));
  let bytes=0,sequence=0;
  function record(message: string) {
    const body={schemaVersion:1,eventId:randomUUID(),runId:id,sequence:sequence+1,type:sequence?"run.progress":"run.started",occurredAt:"2026-10-10T00:00:00.000Z",payload:sequence?{message}:{}};
    return {formatVersion:1,body,digest:canonicalDigest(body)};
  }
  function write(value: ReturnType<typeof record>) {
    const text=JSON.stringify(value);writeFileSync(join(directory,`${value.body.sequence}-${value.body.eventId}.json`),text,{mode:0o600});bytes+=Buffer.byteLength(text);sequence++;
  }
  while(true) {
    const next=record("\0".repeat(4000));
    const futureState=JSON.stringify({...original,allocatedThrough:sequence+1});
    if(bytes+Buffer.byteLength(JSON.stringify(next))+Buffer.byteLength(futureState)>target)break;
    write(next);
  }
  const next=record("x"),base=Buffer.byteLength(JSON.stringify(next))-1;
  const futureState=JSON.stringify({...original,allocatedThrough:sequence+1});
  const available=target-bytes-Buffer.byteLength(futureState)-base;
  if(available>0 && available<=24000) {
    const nulls=Math.min(4000,Math.floor(available/6));
    const spaces=Math.min(4000-nulls,available-nulls*6);
    if(nulls+spaces>0)write(record("\0".repeat(nulls)+" ".repeat(spaces)));
  }
  const state=JSON.stringify({...original,allocatedThrough:sequence});
  const padding=target-bytes-Buffer.byteLength(state);
  if(padding<0||padding>2000)throw new Error("quota fixture target invalid");
  writeFileSync(path,state+" ".repeat(padding));
  if(logicalBytes(directory)!==target)throw new Error("quota fixture length mismatch");
  return sequence;
}
export async function globalQuotaFixture(server: Awaited<ReturnType<typeof import("./server").launch>>) {
  const {registeredRun}=await import("./p06-cli");const {openOutbox}=await import("../../src/cli/outbox");
  const f=await registeredRun(server),root=f.env.AGENTFLOW_OUTBOX_DIR,config={port:server.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined},ids=[f.runId];
  const initializer=await openOutbox(config,performance.now()+5000);
  try{for(let i=0;i<10;i++){const id=randomUUID(),response=await fetch(server.url+"/api/v1/runs",{method:"POST",headers:{Authorization:`Bearer ${config.token}`,"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify({id,projectId:f.projectId,agentId:f.agentId,purpose:"planning"})});if(response.status!==201||(await initializer.initializeRun(id)).kind!=="delivered")throw new Error("quota fixture public initialization failed");ids.push(id);}}finally{initializer.close();}
  const rootBytes=readdirSync(root).reduce((sum,name)=>sum+(lstatSync(join(root,name)).isFile()?lstatSync(join(root,name)).size:0),0),first=9*1024*1024;
  const sequences=[seedRunToBytes(root,ids[0],first),seedRunToBytes(root,ids[1],first)];let remaining=GLOBAL_BYTES-60000-rootBytes-2*first;
  for(let i=2;i<ids.length;i++){const size=Math.floor(remaining/(ids.length-i));sequences.push(seedRunToBytes(root,ids[i],size));remaining-=size;}
  return {...f,root,config,ids,sequences};
}
