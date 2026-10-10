import { readFileSync,writeFileSync,readdirSync,renameSync,symlinkSync,mkdirSync,lstatSync,unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID,createHash } from "node:crypto";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { openOutbox } from "../../src/cli/outbox";
import { createFile } from "../../src/server/filesystem";
function snapshot(root: string): unknown {
  if(lstatSync(root).isFile())return{ino:lstatSync(root).ino,size:lstatSync(root).size,mode:lstatSync(root).mode,hash:createHash("sha256").update(readFileSync(root)).digest("hex")};
  return readdirSync(root).sort().map(name=> {
    const path=join(root,name),stat=lstatSync(path);
    return {name,ino:stat.ino,mode:stat.mode,size:stat.size,content:stat.isDirectory()?snapshot(path):stat.isSymbolicLink()?"symlink":createHash("sha256").update(readFileSync(path)).digest("hex")};
  });
}
it.each(["json","version","generation","wrong-id","watermark","unknown"])("blocks corrupt %s run state and preserves every artifact",async kind=> {
  const server=await launch(),f=await registeredRun(server),root=f.env.AGENTFLOW_OUTBOX_DIR,path=join(root,f.runId,"state.json");
  try {
    const state=JSON.parse(readFileSync(path,"utf8"));
    const changed=kind==="json"?"PRIVATE-P06-CORRUPT-STATE":JSON.stringify({...state,...(kind==="version"?{formatVersion:2}:kind==="generation"?{generation:"PRIVATE-P06-CORRUPT-GENERATION"}:kind==="wrong-id"?{runId:randomUUID()}:kind==="watermark"?{acknowledgedThrough:1}:{unexpected:"PRIVATE-P06-CORRUPT-FIELD"})});
    writeFileSync(path,changed);const before=snapshot(root);
    const result=await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})]);
    expect(result.code).toBe(3);expect(result.stdout).toBe("");expect(result.stderr).not.toContain("PRIVATE-P06");expect(snapshot(root)).toEqual(before);
  }finally{await server.stop();}
});

it.each(["root","run","lock"])("detects a replaced %s identity before any publication",async kind=> {
  const server=await launch(),f=await registeredRun(server),root=f.env.AGENTFLOW_OUTBOX_DIR;
  const outbox=await openOutbox({port:server.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined},performance.now()+5000);
  try {
    const path=kind==="root"?root:kind==="run"?join(root,f.runId):join(root,"publication.sqlite"),saved=join(f.dir,"saved-"+kind);
    renameSync(path,saved);if(kind==="lock")createFile(path);else mkdirSync(path,{mode:0o700});
    const before=snapshot(saved);
    await expect(outbox.enqueue(f.runId,"run.started",{})).rejects.toThrow(kind==="lock"?"lock_changed":"path_changed");
    expect(snapshot(saved)).toEqual(before);
  }finally{outbox.close();await server.stop();}
});

it("rejects a run-directory symlink without following or changing its target",async()=> {
  const server=await launch(),f=await registeredRun(server),root=f.env.AGENTFLOW_OUTBOX_DIR,path=join(root,f.runId),target=join(f.dir,"original-run");
  try {
    renameSync(path,target);symlinkSync(target,path);const before=snapshot(target);
    const result=await f.cli(["flush","--run",f.runId]);expect(result.code).toBe(1);expect(snapshot(target)).toEqual(before);expect(lstatSync(path).isSymbolicLink()).toBe(true);
  }finally{await server.stop();}
});

it("blocks an interior gap and a changed retained digest without modifying watermarks",async()=> {
  const server=await launch(),f=await registeredRun(server),root=f.env.AGENTFLOW_OUTBOX_DIR;
  const config={port:server.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined};
  const outbox=await openOutbox(config,performance.now()+5000);
  try {await outbox.enqueue(f.runId,"run.started",{});await outbox.enqueue(f.runId,"run.heartbeat",{});await outbox.enqueue(f.runId,"run.progress",{message:"PRIVATE-P06-ORIGINAL"});}finally{outbox.close();}
  try {
    const directory=join(root,f.runId),interior=readdirSync(directory).find(name=>name.startsWith("2-"))!;
    const old=readFileSync(join(directory,interior));unlinkSync(join(directory,interior));let before=snapshot(root);
    const missing=await f.cli(["flush","--run",f.runId]);expect(missing.code).toBe(3);expect(missing.stderr).toContain("missing_sequence");expect(snapshot(root)).toEqual(before);
    writeFileSync(join(directory,interior),old,{mode:0o600});const file=readdirSync(directory).find(name=>name.startsWith("3-"))!,record=JSON.parse(readFileSync(join(directory,file),"utf8"));record.body.payload.message="PRIVATE-P06-CHANGED";writeFileSync(join(directory,file),JSON.stringify(record));before=snapshot(root);
    const corrupt=await f.cli(["flush","--run",f.runId]);expect(corrupt.code).toBe(3);expect(corrupt.stdout+corrupt.stderr).not.toContain("PRIVATE-P06");expect(snapshot(root)).toEqual(before);
  }finally{await server.stop();}
});
