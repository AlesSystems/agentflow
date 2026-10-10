import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
const realSpawn=childProcess.spawn;
childProcess.spawn=((command: string,args: readonly string[],options: Parameters<typeof realSpawn>[2])=>realSpawn(command,args.includes("src/cli/main.ts")&&args.includes("flush")?[...args,"--fixture-invalid","true"]:args,options)) as typeof realSpawn;
syncBuiltinESMExports();
const realLaunch=chromium.launch.bind(chromium);
chromium.launch=async options=> {
 const browser=await realLaunch(options),close=browser.close.bind(browser);
 browser.close=async options=> {const cleanupStartedMs=performance.now();await new Promise(resolve=>setTimeout(resolve,500));await close(options);writeFileSync(join(process.env.AGENTFLOW_P06_EVIDENCE_DIR!,"controlled-cleanup.json"),JSON.stringify({cleanupStartedMs,cleanupEndedMs:performance.now(),qualification:"fixture-only controlled cleanup delay"})+"\n",{mode:0o600});};
 return browser;
};
await import("../performance/p06");
