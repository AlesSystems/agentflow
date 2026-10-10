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
