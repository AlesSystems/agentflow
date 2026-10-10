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
