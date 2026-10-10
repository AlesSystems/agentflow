import { spawn } from "node:child_process";
import { existsSync,readFileSync,readdirSync,renameSync,unlinkSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { openOutbox } from "../../src/cli/outbox";
import { createFile,syncDirectory,syncFile } from "../../src/server/filesystem";
async function uncertainAck(server: Awaited<ReturnType<typeof launch>>) {
  const f=await registeredRun(server);
  const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-fault-cli.ts","ack-dir-sync","report","--run",f.runId,"--type","run.started","--payload",f.file({})],{env:{...process.env,...f.env},stdio:"ignore"});
  expect(await new Promise(resolve=>child.on("exit",resolve))).toBe(1);
  const directory=join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId),statePath=join(directory,"state.json"),recordPath=join(directory,readdirSync(directory).find(name=>name.startsWith("1-"))!);
  expect(JSON.parse(readFileSync(statePath,"utf8"))).toMatchObject({allocatedThrough:1,acknowledgedThrough:1});expect(existsSync(recordPath)).toBe(true);
  return{...f,directory,statePath,recordPath,config:{port:server.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined}};
}
it("establishes current acknowledged state file and directory durability before deleting an acknowledged leftover",async()=> {
  const server=await launch(),f=await uncertainAck(server),order:string[]=[];
  try {
    const operations={createFile,renameSync,unlinkSync(path: Parameters<typeof unlinkSync>[0]){if(String(path)===f.recordPath)order.push("unlink-record");unlinkSync(path);},syncDirectory(path:string){if(path===f.directory)order.push("sync-state-directory");syncDirectory(path);},syncFile(path:string){if(path===f.statePath)order.push("sync-state-file");syncFile(path);}};
    const outbox=await openOutbox(f.config,performance.now()+5000,operations);outbox.close();
    expect(order.slice(0,3)).toEqual(["sync-state-file","sync-state-directory","unlink-record"]);expect(existsSync(f.recordPath)).toBe(false);
  }finally{await server.stop();}
});
it("retains the acknowledged record if recovery cannot establish the state durability barrier",async()=> {
  const server=await launch(),f=await uncertainAck(server),original=readFileSync(f.recordPath);
  try {
    const operations={createFile,renameSync,unlinkSync,syncDirectory,syncFile(path:string){if(path===f.statePath)throw Object.assign(new Error("fixture state sync failure"),{code:"EIO"});syncFile(path);}};
    await expect(openOutbox(f.config,performance.now()+5000,operations)).rejects.toThrow("fixture state sync failure");
    expect(readFileSync(f.recordPath)).toEqual(original);
    expect((await f.cli(["flush","--run",f.runId])).code).toBe(0);
  }finally{await server.stop();}
});
