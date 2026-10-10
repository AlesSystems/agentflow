import { spawn } from "node:child_process";
import { mkdtempSync,realpathSync,readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect,it } from "vitest";
it("retains actual failed measured wall time before controlled cleanup and null unfinalized reconciliation",async()=> {
 const evidence=mkdtempSync(join(realpathSync(tmpdir()),"agentflow-p06-repair-failure-"));
 const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-performance-failure.ts","--smoke"],{env:{...process.env,AGENTFLOW_P06_EVIDENCE_DIR:evidence},stdio:["ignore","pipe","pipe"]});
 let stdout="",stderr="";child.stdout.on("data",c=>stdout+=c);child.stderr.on("data",c=>stderr+=c);
 const code=await new Promise(resolve=>child.once("exit",resolve));expect(code,stdout+stderr).toBe(1);
 const receipt=JSON.parse(readFileSync(join(evidence,"performance.json"),"utf8")),result=receipt.flush[0],cleanup=JSON.parse(readFileSync(join(evidence,"controlled-cleanup.json"),"utf8"));
 expect(result.queued).toBe(4);expect(result.flushInvocations[0].code).toBe(1);
 expect(result.measuredStartedMs).toBeGreaterThan(0);expect(result.measuredEndedMs).toBeGreaterThan(result.measuredStartedMs);
 expect(result.elapsedMs).toBe(result.measuredEndedMs-result.measuredStartedMs);
 expect(result.measuredEndedMs).toBeLessThanOrEqual(cleanup.cleanupStartedMs);
 expect(cleanup.cleanupEndedMs-cleanup.cleanupStartedMs).toBeGreaterThanOrEqual(500);
 expect(result).toMatchObject({accepted:null,missing:null,duplicate:null,reconciliation:null,reconciliationStatus:"unfinalized"});
 expect(receipt.comparisons).toEqual([]);expect(receipt.failures).not.toEqual([]);
},60000);
