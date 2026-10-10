import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, readdirSync, lstatSync, symlinkSync, readlinkSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { freePort } from "../fixtures/server";
import { openOutbox } from "../../src/cli/outbox";

function snapshot(directory: string) {
  return readdirSync(directory).sort().map(name=> {
    const path=join(directory,name),stat=lstatSync(path);
    return {name,dev:stat.dev,ino:stat.ino,mode:stat.mode,size:stat.size,content:stat.isSymbolicLink()?readlinkSync(path):readFileSync(path).toString("hex")};
  });
}
async function fixture() {
  const parent=mkdtempSync(join(realpathSync(tmpdir()),"agentflow-p06-lock-sidecars-"));
  const {mkdirSync}=await import("node:fs");
  const root=join(parent,"outbox");mkdirSync(root,{mode:0o700});
  const port=await freePort();
  const meta={formatVersion:1,port,serviceDataDir:join(parent,"service"),generation:"40000000-0000-4000-8000-000000000001",cursor:null,nextOrder:0};
  writeFileSync(join(root,"metadata.json"),JSON.stringify(meta),{mode:0o600});
  for(const name of ["publication.sqlite","delivery.sqlite"])writeFileSync(join(root,name),"",{mode:0o600});
  const token=join(parent,"token");writeFileSync(token,"0".repeat(64),{mode:0o600});
  const file=join(parent,"input.json");writeFileSync(file,JSON.stringify({name:"Synthetic"}),{mode:0o600});
  return {parent,root,port,token,file,config:{port,token:"0".repeat(64),outbox:root,explicitService:undefined}};
}
const cases=["publication","delivery"].flatMap(family=>["-journal","-wal","-shm","-journal.tmp",".unexpected"].flatMap(suffix=>["private","unsafe","symlink"].map(mode=>({family,suffix,mode}))));
it.each(cases)("refuses $mode $family lock$suffix before SQLite can mutate any artifact",async({family,suffix,mode})=> {
  const f=await fixture();
  const sidecar=join(f.root,`${family}.sqlite${suffix}`), target=join(f.parent,"target");
  writeFileSync(target,"PRIVATE-P06-SIDECAR-TARGET",{mode:0o600});
  if(mode==="symlink")symlinkSync(target,sidecar);
  else {writeFileSync(sidecar,suffix==="-journal"?"":"PRIVATE-P06-SIDECAR",{mode:0o600});if(mode==="unsafe")chmodSync(sidecar,0o644);}
  const before=snapshot(f.root),targetBefore=readFileSync(target);
  const child=spawn(process.execPath,["--import","tsx","src/cli/main.ts","project","create","--file",f.file,"--idempotency-key","40000000-0000-4000-8000-000000000002"],{env:{...process.env,PORT:String(f.port),AGENTFLOW_OUTBOX_DIR:f.root,AGENTFLOW_REPORTER_TOKEN_FILE:f.token},stdio:["ignore","pipe","pipe"]});
  let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);
  const code=await new Promise(resolve=>child.on("exit",resolve));
  expect(code).toBe(1);expect(stdout).toBe("");expect(stderr).not.toContain("publication_busy");expect(stderr).not.toContain("PRIVATE-P06");
  expect(snapshot(f.root)).toEqual(before);expect(readFileSync(target)).toEqual(targetBefore);
});

it("refuses a newly introduced sidecar for an already-open sender without calling SQLite lock acquisition",async()=> {
  const f=await fixture();
  const outbox=await openOutbox(f.config,performance.now()+5000);
  const sidecar=join(f.root,"delivery.sqlite-journal");writeFileSync(sidecar,"",{mode:0o600});
  const before=snapshot(f.root);
  try {
    expect(()=>outbox.acquireDelivery()).toThrow("unexpected_lock_sidecar");
    expect(snapshot(f.root)).toEqual(before);
  } finally {outbox.close();}
});

it("refuses an unsafe second-family sidecar before creating a missing first-family lock",async()=> {
  const {unlinkSync}=await import("node:fs");
  const f=await fixture();unlinkSync(join(f.root,"publication.sqlite"));
  const sidecar=join(f.root,"delivery.sqlite-journal");writeFileSync(sidecar,"",{mode:0o600});chmodSync(sidecar,0o644);
  const before=snapshot(f.root);
  await expect(openOutbox(f.config,performance.now()+5000)).rejects.toThrow("UNSAFE_PERMISSIONS");
  expect(snapshot(f.root)).toEqual(before);
});

it("preserves an oversized existing bootstrap lock before opening SQLite",async()=> {
  const f=await fixture();
  writeFileSync(join(f.root,"delivery.sqlite"),Buffer.alloc(65537));
  const before=snapshot(f.root);
  await expect(openOutbox(f.config,performance.now()+5000)).rejects.toThrow("bootstrap_oversize");
  expect(snapshot(f.root)).toEqual(before);
});

it("stops a bootstrap-size failure before creating the second lock or admitting metadata",async()=> {
  const {unlinkSync,renameSync,existsSync}=await import("node:fs");
  const {createFile,syncDirectory}=await import("../../src/server/filesystem");
  const f=await fixture();
  unlinkSync(join(f.root,"publication.sqlite"));unlinkSync(join(f.root,"delivery.sqlite"));
  const originalMetadata=readFileSync(join(f.root,"metadata.json"));
  await expect(openOutbox(f.config,performance.now()+5000,{createFile(path){createFile(path,Buffer.alloc(65537));},renameSync,unlinkSync,syncDirectory})).rejects.toThrow("bootstrap_oversize");
  expect(lstatSync(join(f.root,"publication.sqlite")).size).toBe(65537);
  expect(existsSync(join(f.root,"delivery.sqlite"))).toBe(false);
  expect(readFileSync(join(f.root,"metadata.json"))).toEqual(originalMetadata);
  expect(readdirSync(f.root).sort()).toEqual(["metadata.json","publication.sqlite"]);
});

it("initializes both empty stable locks once and repeated exclusive transactions create no sidecars or content changes",async()=> {
  const f=await fixture();
  const outbox=await openOutbox(f.config,performance.now()+5000);
  const locksBefore=snapshot(f.root).filter(file=>file.name.endsWith(".sqlite"));
  try {
    expect(locksBefore.map(file=>file.size)).toEqual([4096,4096]);
    expect(outbox.acquireDelivery()).toBe(true);
    expect(readdirSync(f.root).sort()).toEqual(["delivery.sqlite","metadata.json","publication.sqlite"]);
    await outbox.cursor();await outbox.cursor();
    expect(snapshot(f.root).filter(file=>file.name.endsWith(".sqlite"))).toEqual(locksBefore);
  } finally {outbox.close();}
  const reopened=await openOutbox(f.config,performance.now()+5000);
  try {expect(reopened.acquireDelivery()).toBe(true);expect(snapshot(f.root).filter(file=>file.name.endsWith(".sqlite"))).toEqual(locksBefore);}finally{reopened.close();}
});

it.each(["created","first-initialized"])("recovers partial bootstrap after real SIGKILL at %s without replacing a stable inode",async phase=> {
  const {unlinkSync}=await import("node:fs");
  const f=await fixture();
  if(phase==="created"){unlinkSync(join(f.root,"publication.sqlite"));unlinkSync(join(f.root,"delivery.sqlite"));}
  const originalMetadata=readFileSync(join(f.root,"metadata.json"));
  const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-lock-bootstrap.ts",phase,"project","create","--file",f.file,"--idempotency-key","40000000-0000-4000-8000-000000000002"],{env:{...process.env,PORT:String(f.port),AGENTFLOW_OUTBOX_DIR:f.root,AGENTFLOW_REPORTER_TOKEN_FILE:f.token},stdio:"ignore"});
  const signal=await new Promise(resolve=>child.on("exit",(_code,signal)=>resolve(signal)));
  expect(signal).toBe("SIGKILL");
  expect(readFileSync(join(f.root,"metadata.json"))).toEqual(originalMetadata);
  expect(readdirSync(f.root).filter(name=>name.startsWith("registration-")).length).toBe(0);
  const publication=lstatSync(join(f.root,"publication.sqlite"));
  const outbox=await openOutbox(f.config,performance.now()+5000);
  try {expect(lstatSync(join(f.root,"publication.sqlite")).ino).toBe(publication.ino);expect(outbox.acquireDelivery()).toBe(true);expect(readdirSync(f.root).sort()).toEqual(["delivery.sqlite","metadata.json","publication.sqlite"]);}finally{outbox.close();}
});

it("concurrent first CLI invocations use the same stable bootstrap inodes and preserve only durably admitted work",async()=> {
  const {unlinkSync,existsSync}=await import("node:fs");
  const f=await fixture();unlinkSync(join(f.root,"publication.sqlite"));unlinkSync(join(f.root,"delivery.sqlite"));
  const results=await Promise.all(["40000000-0000-4000-8000-000000000002","40000000-0000-4000-8000-000000000003"].map(async key=> {
    const child=spawn(process.execPath,["--import","tsx","src/cli/main.ts","project","create","--file",f.file,"--idempotency-key",key],{env:{...process.env,PORT:String(f.port),AGENTFLOW_OUTBOX_DIR:f.root,AGENTFLOW_REPORTER_TOKEN_FILE:f.token},stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);
    const code=await new Promise(resolve=>child.on("exit",resolve));return{key,code,stdout,stderr};
  }));
  expect(results.some(result=>result.code===2),JSON.stringify({results,files:snapshot(f.root).map(file=>({name:file.name,ino:file.ino,size:file.size,mode:file.mode}))})).toBe(true);
  for(const result of results){expect([1,2]).toContain(result.code);expect(result.stdout).toBe("");if(result.code===2)expect(existsSync(join(f.root,`registration-${result.key}.json`))).toBe(true);else expect(result.stderr).not.toContain('"queued"');}
  const before=snapshot(f.root).filter(file=>file.name.endsWith(".sqlite"));
  const reopened=await openOutbox(f.config,performance.now()+5000);
  try{expect(snapshot(f.root).filter(file=>file.name.endsWith(".sqlite"))).toEqual(before);expect(reopened.acquireDelivery()).toBe(true);}finally{reopened.close();}
});

it("adopts a peer's completed delivery-header bootstrap only under publication ownership without reinitializing it",async()=> {
  const Database=(await import("better-sqlite3")).default;
  const {createFile,syncDirectory,syncFile}=await import("../../src/server/filesystem");
  const {renameSync,unlinkSync}=await import("node:fs");
  const f=await fixture();let peer=false;const delivery=join(f.root,"delivery.sqlite");let completed: ReturnType<typeof snapshot>[number]|undefined;
  const outbox=await openOutbox(f.config,performance.now()+5000,{createFile,renameSync,unlinkSync,syncDirectory,syncFile(path){syncFile(path);if(!peer&&path===join(f.root,"publication.sqlite")){peer=true;const publication=new Database(path),other=new Database(delivery);try{publication.exec("BEGIN EXCLUSIVE");other.pragma("user_version=0");syncFile(delivery);syncDirectory(f.root);completed=snapshot(f.root).find(file=>file.name==="delivery.sqlite");publication.exec("ROLLBACK");}finally{other.close();publication.close();}}}});
  try{expect(peer).toBe(true);expect(snapshot(f.root).find(file=>file.name==="delivery.sqlite")).toEqual(completed);expect(outbox.acquireDelivery()).toBe(true);}finally{outbox.close();}
});
