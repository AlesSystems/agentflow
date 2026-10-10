import { expect,it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync,realpathSync,readdirSync,readFileSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { openOwnedStore,migrations } from "../../src/db";
import { freePort,stop,launch } from "../fixtures/server";
it("transactional shipping-bootstrap migration failure preserves rows and generation before any listener",async()=>{
  const dir=mkdtempSync(join(realpathSync(tmpdir()),"p07-migration-"));
  const owned=await openOwnedStore(dir);const metadata=owned.store.metadata();owned.close();
  const before=migrations.map(m=>m.sha256),port=await freePort(),probes:{at:number;reachable:boolean}[]=[];
  const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p07-migration-runtime.ts"],{env:{...process.env,AGENTFLOW_DATA_DIR:dir,PORT:String(port)},stdio:["ignore","pipe","pipe"]});
  let stderr="";child.stderr.on("data",data=>stderr+=data);
  const exit=new Promise<number|null>(resolve=>child.once("exit",resolve));let finished=false;void exit.then(()=>finished=true);
  const started=performance.now();
  try{
    while(!finished&&performance.now()-started<5000){let reachable=false;try{await fetch(`http://127.0.0.1:${port}/api/v1/health`);reachable=true;}catch{}probes.push({at:performance.now(),reachable});await new Promise(resolve=>setTimeout(resolve,10));}
    if(!finished)await stop(child);
    expect(await exit).toBe(1);expect(stderr).toContain("no such table: missing_p07");expect(probes.every(p=>!p.reachable)).toBe(true);
    const backups=readdirSync(join(dir,"backups")).filter(f=>f.startsWith("pre-migration-"));expect(backups).toHaveLength(1);
    const db=new Database(join(dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT generation,schema_version AS schemaVersion FROM instance_metadata").get()).toEqual(metadata);expect(db.prepare("SELECT count(*) n FROM migration_history").get()).toEqual({n:6});expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='p07_transaction_work'").all()).toEqual([]);expect(db.pragma("integrity_check",{simple:true})).toBe("ok");}finally{db.close();}
    const backup=new Database(join(dir,"backups",backups[0]),{readonly:true});try{expect(backup.pragma("integrity_check",{simple:true})).toBe("ok");expect(backup.prepare("SELECT generation,schema_version AS schemaVersion FROM instance_metadata").get()).toEqual(metadata);}finally{backup.close();}
    expect(migrations.map(m=>createHash("sha256").update(readFileSync(join("migrations",m.id+".sql"))).digest("hex"))).toEqual(before);
    const recovered=await launch({dir,port});await recovered.stop();
    if(process.env.AGENTFLOW_P07_EVIDENCE_DIR)writeFileSync(join(process.env.AGENTFLOW_P07_EVIDENCE_DIR,"migration.json"),JSON.stringify({dir,port,probes,backups,metadata,shippingHashes:before,exit:1,stderr},null,2),{mode:0o600});
  }finally{await stop(child);}
},10000);
