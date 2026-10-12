import { expect,it } from "vitest";
import { chmodSync,existsSync,mkdirSync,mkdtempSync,realpathSync,symlinkSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { campaignDeclarations } from "../fixtures/w03c-campaign";

for(const defect of ["missing","file","symlink","mode"] as const)it(`rejects ${defect} sql-copies at controller preflight before release or service entry`,()=>{
 const proof=realpathSync(mkdtempSync(join(tmpdir(),"w03c-layout-")));chmodSync(proof,0o700);mkdirSync(join(proof,"fixtures"),{mode:0o700});
 const destination=join(proof,"sql-copies");
 if(defect==="file")writeFileSync(destination,"private",{mode:0o600});
 else if(defect==="symlink")symlinkSync(join(proof,"fixtures"),destination);
 else if(defect==="mode")mkdirSync(destination,{mode:0o755});
 const result=spawnSync(process.execPath,["--import","tsx","tests/performance/w03c.ts","--phase","run","--base-root",process.cwd(),"--head-root",process.cwd(),"--proof-dir",proof,"--runtime-root",proof],{cwd:process.cwd(),env:{...process.env,AGENTFLOW_W03C_QUIET_RELEASE:""},encoding:"utf8"});
 expect(result.status).toBe(1);expect(result.stderr).toContain("campaign output layout");expect(result.stderr).not.toContain("Root explicit quiet release");
 expect(existsSync(join(proof,"capture.jsonl"))).toBe(false);expect(existsSync(join(proof,"campaign-result.json"))).toBe(false);
 expect(campaignDeclarations()).toHaveLength(3810);
});
