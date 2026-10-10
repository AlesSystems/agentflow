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

it.each(["metadata-json","metadata-schema","record-json","record-schema","association-missing"])("blocks retained %s damage without replacing state or guessing its destination",async kind=> {
  const server=await launch(),f=await registeredRun(server),root=f.env.AGENTFLOW_OUTBOX_DIR;
  try {
    if(kind.startsWith("record")){const outbox=await openOutbox({port:server.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined},performance.now()+5000);try{await outbox.enqueue(f.runId,"run.started",{});}finally{outbox.close();}}
    const path=kind.startsWith("metadata")||kind==="association-missing"?join(root,"metadata.json"):join(root,f.runId,readdirSync(join(root,f.runId)).find(name=>name.startsWith("1-"))!);
    if(kind==="association-missing")unlinkSync(path);else if(kind.endsWith("json"))writeFileSync(path,"PRIVATE-P06-RETAINED-DAMAGE");else{const value=JSON.parse(readFileSync(path,"utf8"));writeFileSync(path,JSON.stringify({...value,unexpected:"PRIVATE-P06-UNKNOWN-FIELD"}));}
    const before=snapshot(root),result=await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})]);
    expect(result.code).toBe(3);expect(result.stdout+result.stderr).not.toContain("PRIVATE-P06");expect(snapshot(root)).toEqual(before);
  }finally{await server.stop();}
});

it.each(["metadata","state"])("preserves corrupt complete %s replacement temps instead of silently deleting them",async kind=> {
  const server=await launch(),f=await registeredRun(server),root=f.env.AGENTFLOW_OUTBOX_DIR,path=kind==="metadata"?join(root,"metadata.json.tmp"):join(root,f.runId,"state.json.tmp");
  try{writeFileSync(path,JSON.stringify({PRIVATE_P06_UNRELATED:"unverifiable"}),{mode:0o600});const before=snapshot(root),result=await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})]);expect(result.code).toBe(3);expect(result.stdout+result.stderr).not.toContain("PRIVATE_P06");expect(snapshot(root)).toEqual(before);}finally{await server.stop();}
});

it.each(["metadata","state"])("preserves corrupt UTF-8 inside a complete %s replacement temp",async kind=> {
  const server=await launch(),f=await registeredRun(server),root=f.env.AGENTFLOW_OUTBOX_DIR,base=kind==="metadata"?join(root,"metadata.json"):join(root,f.runId,"state.json"),path=base+".tmp";
  try{const value=JSON.parse(readFileSync(base,"utf8")),bytes=Buffer.from(JSON.stringify({...value,unexpected:"PRIVATE-P06-INVALID"}));bytes[bytes.indexOf(Buffer.from("PRIVATE"))]=255;writeFileSync(path,bytes,{mode:0o600});const before=snapshot(root),result=await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})]);expect(result.code).toBe(3);expect(snapshot(root)).toEqual(before);}finally{await server.stop();}
});

it.each(["digest","filename","reservation","body","temp"])("preserves a corrupt registration %s descriptor or temp without guessing a replacement",async kind=> {
  const {syncDirectory}=await import("../../src/server/filesystem");const {canonicalDigest}=await import("../../src/domain/request-digest");
  const server=await launch(),f=await registeredRun(server),root=f.env.AGENTFLOW_OUTBOX_DIR,key=randomUUID(),body={name:"PRIVATE-P06-ORIGINAL"};
  try {
    const outbox=await openOutbox({port:server.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined},performance.now()+5000,{createFile(path,value){if(path.endsWith(`registration-${key}.json.tmp`)){writeFileSync(path,Buffer.from(String(value)).subarray(0,50),{mode:0o600});throw new Error("fixture partial journal");}createFile(path,value);},renameSync,unlinkSync,syncDirectory});
    try{await expect(outbox.preserveRegistration("/projects",key,body)).rejects.toThrow("fixture partial journal");}finally{outbox.close();}
    const metaPath=join(root,"metadata.json"),meta=JSON.parse(readFileSync(metaPath,"utf8"));expect(meta.pendingRegistration.record.digest).toBe(canonicalDigest(body));
    if(kind==="temp")writeFileSync(join(root,`registration-${key}.json.tmp`),"PRIVATE-P06-WRONG-TEMP");else{if(kind==="digest")meta.pendingRegistration.record.digest="0".repeat(64);if(kind==="filename")meta.pendingRegistration.filename=`registration-${randomUUID()}.json`;if(kind==="reservation")meta.pendingRegistration.remainingPeak++;if(kind==="body")meta.pendingRegistration.record.body.name="PRIVATE-P06-CHANGED";writeFileSync(metaPath,JSON.stringify(meta));}
    const before=snapshot(root),result=await f.cli(["flush"]);expect(result.code).toBe(3);expect(result.stdout+result.stderr).not.toContain("PRIVATE-P06");expect(snapshot(root)).toEqual(before);
  }finally{await server.stop();}
});

it.each(["after-create","after-rename"])("rechecks the run directory before the next publication mutation %s",async point=> {
  const {syncDirectory}=await import("../../src/server/filesystem");
  const server=await launch(),f=await registeredRun(server),root=f.env.AGENTFLOW_OUTBOX_DIR,directory=join(root,f.runId),saved=join(f.dir,"displaced-run");
  let changed=false,unsafeSync=false;
  function replace(){changed=true;renameSync(directory,saved);mkdirSync(directory,{mode:0o700});createFile(join(directory,"state.json.tmp"),"PRIVATE-P06-UNRELATED-TEMP");}
  try {
    const outbox=await openOutbox({port:server.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined},performance.now()+5000,{createFile(path,value){createFile(path,value);if(point==="after-create"&&!changed&&path.endsWith("state.json.tmp"))replace();},renameSync(from,to){renameSync(from,to);if(point==="after-rename"&&!changed&&String(to).endsWith("state.json"))replace();},unlinkSync,syncDirectory(path){if(changed&&path===directory)unsafeSync=true;syncDirectory(path);}});
    try{await expect(outbox.enqueue(f.runId,"run.started",{})).rejects.toThrow("path_changed");expect(readFileSync(join(directory,"state.json.tmp"),"utf8")).toBe("PRIVATE-P06-UNRELATED-TEMP");expect(unsafeSync).toBe(false);}finally{outbox.close();}
  }finally{await server.stop();}
});

it.each(["metadata","state"])("validates the JSON context before recovering split UTF-8 in %s temps",async kind=> {
  const {existsSync}=await import("node:fs");
  const server=await launch(),f=await registeredRun(server),root=f.env.AGENTFLOW_OUTBOX_DIR;
  const base=kind==="metadata"?join(root,"metadata.json"):join(root,f.runId,"state.json"),path=base+".tmp";
  const value=JSON.parse(readFileSync(base,"utf8"));
  const prefix=kind==="metadata"?JSON.stringify({formatVersion:1,port:value.port,serviceDataDir:value.serviceDataDir,generation:value.generation}).slice(0,-1):JSON.stringify({formatVersion:1,runId:value.runId}).slice(0,-1);
  const config={port:server.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined};
  try {
    for(const suffix of [',"cursor":!',',"cursor":', '}',' ,"cursor":"\\',',"cursor":"\\u',',"cursor":"\\u12']) {
      writeFileSync(path,Buffer.concat([Buffer.from(prefix+suffix),Buffer.from([0xc3])]),{mode:0o600});
      const before=snapshot(root);
      await expect(openOutbox(config,performance.now()+5000)).rejects.toThrow("corrupt_temporary");
      expect(snapshot(root)).toEqual(before);unlinkSync(path);
    }
    for(const scalar of ["é","€","😀"])for(let split=1;split<Buffer.byteLength(scalar);split++) {
      writeFileSync(path,Buffer.concat([Buffer.from(prefix+',"cursor":"ordinary'),Buffer.from(scalar).subarray(0,split)]),{mode:0o600});
      const outbox=await openOutbox(config,performance.now()+5000);outbox.close();expect(existsSync(path)).toBe(false);
    }
  }finally{await server.stop();}
});
