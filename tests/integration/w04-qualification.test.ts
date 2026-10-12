import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect,it } from "vitest";
import { validateOutputRoot } from "../fixtures/w04-qualification";
const root=()=>mkdtempSync(join(process.env.TMPDIR??tmpdir(),"w04-qualification-"));
it("requires a real private unused output directory",()=>{const p=root();expect(validateOutputRoot(p)).toMatchObject({mode:448,uid:process.getuid!()});writeFileSync(join(p,"existing"),"held");expect(()=>validateOutputRoot(p)).toThrow(/unused/);});
it("rejects files, symlinks, and wrong modes before writing",()=>{const p=root(),file=join(p,"file"),link=join(p,"link"),publicDir=join(p,"public");writeFileSync(file,"held");symlinkSync(p,link);mkdirSync(publicDir);chmodSync(publicDir,0o755);for(const path of [file,link,publicDir])expect(()=>validateOutputRoot(path)).toThrow();expect(readFileSync(file,"utf8")).toBe("held");});
for(const phase of ["unknown","run"] as const)it(`actual controller rejects ${phase} before any service or sample attempt`,()=>{
 const proof=root();const child=spawnSync(process.execPath,["--import","tsx","tests/performance/w04.ts","--phase",phase,"--base-root",process.cwd(),"--head-root",process.cwd(),"--proof-dir",proof,"--runtime-root",join(process.execPath,"../..")],{cwd:process.cwd(),env:{...process.env,AGENTFLOW_W04_QUIET_RELEASE:""},encoding:"utf8"});
 expect(child.status).toBe(1);const row=JSON.parse(child.stdout.trim());expect(row).toMatchObject({kind:"preflightRejected",servicesStarted:0,sampleAttempts:0});expect(row.reason).toMatch(phase==="unknown"?/phase/:/Root.*release/);
});
