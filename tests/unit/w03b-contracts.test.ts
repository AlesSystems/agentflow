import { expect, it } from "vitest";
import { matchEndpoint } from "../../src/contracts/routes";
it("registers one human-only finite selected export transport", () => {
  const endpoint = matchEndpoint("GET", "/api/v1/export")?.endpoint;
  expect(endpoint?.kind).toBe("export");
  expect(endpoint?.access).toBe("human");
  expect(matchEndpoint("HEAD", "/api/v1/export")?.endpoint).toBe(endpoint);
});

import { historyExportInput, parseHistoryExportRequest, historyEventRecord } from "../../src/contracts/history";
import { eventInput } from "../../src/contracts/observations";
it("rejects empty, duplicated, reordered and unknown selected groups and repeated query keys",()=>{
  const generation="10000000-0000-4000-8000-000000000004";
  for(const content of [[],["tasks","tasks"],["github","tasks"],["unknown"]])expect(historyExportInput.safeParse({content,generation}).success).toBe(false);
  for(const query of ["content=tasks&content=tasks","content=tasks&cursor=0","content=tasks&generation=x","content=tasks&generation="+generation+"&generation="+generation])expect(()=>parseHistoryExportRequest(new URL("http://localhost/export?"+query+"&generation="+generation))).toThrow();
});
it("accepts only the readonly retained progress and heartbeat stub shape",()=>{
  const stub={schemaVersion:1,eventId:"10000000-0000-4000-8000-000000000001",runId:"10000000-0000-4000-8000-000000000002",sequence:1,type:"run.progress",occurredAt:"2026-10-12T00:00:00.000Z",receivedAt:"2026-10-12T00:00:00.000Z",payload:null,payloadPrunedAt:"2026-10-12T00:00:00.000Z"};
  expect(historyEventRecord.safeParse(stub).success).toBe(true);
  expect(historyEventRecord.safeParse({...stub,type:"run.succeeded"}).success).toBe(false);
  expect(historyEventRecord.safeParse({...stub,payloadPrunedAt:null}).success).toBe(false);
  expect(eventInput.safeParse(stub).success).toBe(false);
});

import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readdirSync, symlinkSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openOwnedStore } from "../../src/db";
import { HistoryRuntime } from "../../src/history/runtime";
it("returns exact zero counts for empty selected history and releases the readonly reader",async()=>{
  const dir=mkdtempSync(join(realpathSync(tmpdir()),"w03b-empty-"));const owned=await openOwnedStore(dir);
  try {
    const destination=join(dir,"empty.sqlite");
    const snapshot=await owned.store.prepareHistoryExport(destination,{content:["tasks","attempts","workflows"],generation:owned.store.metadata().generation},new AbortController().signal);
    expect(Object.values(snapshot.manifest.counts).every(count=>count===0)).toBe(true);
    expect(snapshot.nextBatch()).toEqual([]);snapshot.close();snapshot.close();expect(()=>snapshot.nextBatch()).toThrow("EXPORT_CLOSED");
  }finally{await owned.store.drain();owned.close();}
});
it("startup removes only proven private abandoned export children after instance ownership",async()=>{
  const dir=mkdtempSync(join(realpathSync(tmpdir()),"w03b-startup-"));const owned=await openOwnedStore(dir);
  const parent=join(dir,"exports");mkdirSync(parent,{mode:0o700});
  const safe=randomUUID(),foreign=randomUUID(),link=randomUUID();
  mkdirSync(join(parent,safe),{mode:0o700});writeFileSync(join(parent,safe,"snapshot.sqlite"),"synthetic abandoned copy",{mode:0o600});
  mkdirSync(join(parent,foreign),{mode:0o700});writeFileSync(join(parent,foreign,"unrecognized"),"retain",{mode:0o600});
  symlinkSync(join(parent,foreign),join(parent,link));
  const history=new HistoryRuntime(owned.store);
  expect(readdirSync(parent).sort()).toEqual([foreign,link].sort());expect(lstatSync(join(parent,link)).isSymbolicLink()).toBe(true);
  await history.close();owned.close();
});

import { chmodSync } from "node:fs";
import { startRuntime } from "../../src/server/launcher";
import { readConfig } from "../../src/server/config";
it("releases the instance lock if the export parent fails startup validation",async()=>{
  const dir=mkdtempSync(join(realpathSync(tmpdir()),"w03b-invalid-parent-"));const owned=await openOwnedStore(dir);owned.close();
  mkdirSync(join(dir,"exports"),{mode:0o700});chmodSync(join(dir,"exports"),0o777);
  await expect(startRuntime(readConfig({...process.env,AGENTFLOW_DATA_DIR:dir,PORT:"34567"},"production"))).rejects.toThrow("UNSAFE_PERMISSIONS");
  const reopened=await openOwnedStore(dir);reopened.close();
});

import { clearRuntime, publishRuntime } from "../../src/server/runtime";
it("rejects a duplicate runtime publication before constructing another export owner",async()=>{
  const dir=mkdtempSync(join(realpathSync(tmpdir()),"w03b-duplicate-owner-"));const owned=await openOwnedStore(dir);
  const config=readConfig({...process.env,AGENTFLOW_DATA_DIR:dir,PORT:"34567"},"production");
  try {
    publishRuntime(config,owned);
    const child=randomUUID();mkdirSync(join(dir,"exports",child),{mode:0o700});writeFileSync(join(dir,"exports",child,"snapshot.sqlite"),"owned ongoing copy",{mode:0o600});
    expect(()=>publishRuntime(config,owned)).toThrow("RUNTIME_ALREADY_OWNED");
    expect(readdirSync(join(dir,"exports"))).toEqual([child]);
  }finally{clearRuntime();owned.close();}
});
