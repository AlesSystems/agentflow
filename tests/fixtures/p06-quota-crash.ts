import { readFileSync,renameSync,unlinkSync } from "node:fs";
import { join } from "node:path";
import { createFile,syncDirectory } from "../../src/server/filesystem";
import { main } from "../../src/cli/main";
import { openOutbox } from "../../src/cli/outbox";
import { logicalBytes } from "./p06-quota";
const [phase,...args]=process.argv.slice(2);
process.exitCode=await main(args,(config,end)=>openOutbox(config,end,{
  createFile(path,body){createFile(path,body);sample(path);if(phase==="record-temp" && /\/[1-9][0-9]*-[a-f0-9-]{36}\.json\.tmp$/.test(path))process.kill(process.pid,"SIGKILL");},
  renameSync(from,to){renameSync(from,to);sample(String(to));if(String(to).endsWith("state.json")){const state=JSON.parse(readFileSync(to,"utf8"));if(state.pending){process.send?.({kind:"identity",eventId:state.pending.record.body.eventId,sequence:state.allocatedThrough});if(phase==="descriptor")process.kill(process.pid,"SIGKILL");}}else if(phase==="record" && /\/[1-9][0-9]*-[a-f0-9-]{36}\.json$/.test(String(to)))process.kill(process.pid,"SIGKILL");},
  unlinkSync(path){unlinkSync(path);sample(String(path));},syncDirectory,
}));
function sample(path: string){const root=process.env.AGENTFLOW_OUTBOX_DIR!;const runId=args[args.indexOf("--run")+1].toLowerCase();process.send?.({kind:"sample",global:logicalBytes(root),run:logicalBytes(join(root,runId)),phase:path.endsWith("state.json")?"state":"file"});}
