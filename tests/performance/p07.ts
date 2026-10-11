import {flushRun} from "../fixtures/p07-flush-stage";
import {retainedApplication} from "../fixtures/p07-app-build";
import {nativeCompare} from "../fixtures/p07-native";
import {ordinaryStages,ordinaryBoundary} from "../fixtures/p07-ordinary";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir, release } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import Database from "better-sqlite3";
import { seedPerformance } from "../fixtures/p06-performance";

import { loadScenario, resourceProof } from "../fixtures/p07-load";
const baselineSha = "36f6d1bc4699c706e3f57a17cfcc85a1576c648b";
const mode = process.argv[2];
assert(["--smoke", "--acceptance"].includes(mode), "Select --smoke or reviewed quiet-window --acceptance explicitly");
const acceptance = mode === "--acceptance";
const evidence = process.env.AGENTFLOW_P07_EVIDENCE_DIR;
assert(evidence, "AGENTFLOW_P07_EVIDENCE_DIR required");
assert(statSync(evidence).isDirectory(), "evidence directory required");
assert(!existsSync(join(evidence, "performance.json")), "Use a fresh evidence directory; never overwrite a run");
const counts = acceptance ? { tasks: 1000, events: 10000, producers: 10, queued: 1000, samples: 100, repetitions: 3 } : { tasks: 12, events: 20, producers: 2, queued: 4, samples: 5, repetitions: 1 };
const root = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-p07-performance-"));
const owned: string[] = [root];
const addonProbe = new Database(":memory:"); addonProbe.close();
const sqliteAddon = Object.keys(createRequire(import.meta.url).cache).find(path => path.includes("/better-sqlite3/") && path.endsWith(".node"));
assert(sqliteAddon,"loaded SQLite addon fingerprint required");
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function fileHashes(dir: string): Record<string, string> {
  const result: Record<string,string> = {};
  for (const entry of readdirSync(dir, { recursive: true })) {
    const path = join(dir, String(entry));
    if (statSync(path).isFile()) result[relative(dir,path)] = hash(readFileSync(path));
  }
  return result;
}
const receipt: { mode: string; acceptance: boolean; startedAt: string; runtime: unknown; provenance: unknown; owned: string[]; flush: unknown[]; comparisons: unknown[]; failures: string[]; finishedAt?: string; cleanup?: string } = {
  mode: acceptance ? "acceptance" : "smoke", acceptance, startedAt: new Date().toISOString(),
  runtime: { node: process.version, osRelease: release(), platform: process.platform, arch: process.arch, macOS: execFileSync("sw_vers", [], { encoding: "utf8" }).trim(), npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim() },
  provenance: {}, owned, flush: [], comparisons: [], failures: [],
};
function writeReceipt() { writeFileSync(join(evidence!, "performance.json"), JSON.stringify(receipt,null,2)+"\n", { mode: 0o600 }); }
let save=writeReceipt;



await ordinaryBoundary(receipt,async safeSave=>{
  save=safeSave;
  const applicationQualification=retainedApplication(baselineSha);
  const baseSource=join(root,"p06-source");mkdirSync(baseSource,{mode:0o700});
  const archive=execFileSync("git",["archive",baselineSha],{maxBuffer:20*1024*1024});
  execFileSync("tar",["-xf","-","-C",baseSource],{input:archive});
  assert.equal(hash(readFileSync("package-lock.json")),hash(readFileSync(join(baseSource,"package-lock.json"))),"baseline/head dependency lock must match");
  symlinkSync(join(process.cwd(),"node_modules"),join(baseSource,"node_modules"));
  const baseBuildDir = process.env.AGENTFLOW_P07_BASE_BUILD_DIR ?? join(process.cwd(),".next");
  assert(isAbsolute(baseBuildDir),"baseline build directory must be absolute");
  const baseBuildId = readFileSync(join(baseBuildDir,"BUILD_ID"),"utf8").trim();
  assert.equal(baseBuildId, readFileSync(".next/BUILD_ID","utf8").trim(), "P06 runtime source-equivalent retained head assets required");
  cpSync(baseBuildDir,join(baseSource,".next"),{recursive:true});
  receipt.provenance={applicationQualification,baselineSha,headSha:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),workingDiffSha256:hash(execFileSync("git",["diff","HEAD"])),baseArchiveSha256:hash(archive),lockSha256:hash(readFileSync("package-lock.json")),baselineLockSha256:hash(readFileSync(join(baseSource,"package-lock.json"))),sqliteAddonSha256:hash(readFileSync(sqliteAddon)),baselineCachedBuildId:baseBuildId,headCachedBuildId:readFileSync(".next/BUILD_ID","utf8").trim(),baselineCachedAssets:process.env.AGENTFLOW_P07_BASE_BUILD_DIR ? "explicit retained source-equivalent assets" : "ordinary fresh-install assets copied for identical runtime/build inputs",cachedBuildHashes:fileHashes(join(baseSource,".next")),helperHashes:Object.fromEntries(["tests/performance/p07.ts","tests/fixtures/p07-load.ts","tests/fixtures/p07-protocol.ts","tests/fixtures/p07-runtime.ts","tests/fixtures/p07-flush.ts","tests/fixtures/p07-flush-stage.ts","tests/fixtures/p07-app-build.ts","tests/fixtures/p07-flush-boundary.ts","tests/fixtures/p07-native.ts","tests/fixtures/p07-ordinary.ts","tests/fixtures/p07-proof-errors.ts","tests/fixtures/p07-warm-error.ts","tests/fixtures/p07-resource-boundary.ts","tests/fixtures/p06-performance.ts","tests/fixtures/p06-proxy.ts","tests/fixtures/server.ts","src/cli/main.ts","src/cli/outbox.ts","src/cli/http.ts","src/cli/config.ts"].map(path=>[path,hash(readFileSync(path))])),comparison:"Equivalent native public HTTP operations on copied identical synthetic dataset. Application/server inputs remain byte-identical; reviewed CLI-only outbox exception executes current tsx source. Retained initial fresh-build assets qualify the application only; native HTTP uses each label's unchanged application source."};
  save();
  await ordinaryStages({repetitions:counts.repetitions,
    load:async index=>{console.log(JSON.stringify({stage:"load",index,acceptance}));const result=await loadScenario(root,index,acceptance);(receipt as unknown as Record<string,unknown[]>).loads??=[];(receipt as unknown as Record<string,unknown[]>).loads.push(result);save();},
    resource:async()=>{(receipt as unknown as Record<string,unknown>).resources=await resourceProof(root,acceptance);save();},flush:index=>flushRun(index,{root,counts,acceptance,receipt,writeReceipt}),
    prepareNative:async()=>{const seedDir=join(root,"comparison-seed");return {seedDir,seed:await seedPerformance(seedDir,counts)};},
    compare:async(index,input)=>{await nativeCompare({index,baseSource,...input,root,counts,acceptance,receipt,save:writeReceipt});}
  });
  assert.equal(receipt.failures.length,0,"performance budget failures remain open");
},writeReceipt,()=>console.log(JSON.stringify({mode:receipt.mode,acceptance,flushRuns:receipt.flush.length,comparisons:receipt.comparisons.length,failures:receipt.failures})),()=>{process.exitCode=1;}).catch(()=>{process.exitCode=1;});
