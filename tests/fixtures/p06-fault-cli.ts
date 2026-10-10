import { readFileSync,writeFileSync,renameSync,unlinkSync } from "node:fs";
import { createFile,syncDirectory } from "../../src/server/filesystem";
import { main } from "../../src/cli/main";
import { openOutbox } from "../../src/cli/outbox";
const [failure,...args]=process.argv.slice(2);
let last="",injected=false;
function stage(path: string,contents: string) {
  if(path.endsWith("metadata.json.tmp"))return JSON.parse(contents).pendingRegistration?"registration-descriptor":"registration-clear";
  if(/registration-[a-f0-9-]{36}\.json\.tmp$/.test(path))return "registration";
  if(path.endsWith("state.json.tmp")){const state=JSON.parse(contents);return state.pending?"descriptor":state.acknowledgedThrough===1?"ack":state.allocatedThrough===1?"clear":"init";}
  if(/\/[1-9][0-9]*-[a-f0-9-]{36}\.json\.tmp$/.test(path))return "record";
  return "other";
}
function reject(point: string){if(!injected&&failure===point){injected=true;throw Object.assign(new Error("PRIVATE-P06-IO-ERROR-SENTINEL"),{code:point.endsWith("write")?"ENOSPC":"EIO"});}}
process.exitCode=await main(args,(config,end)=>openOutbox(config,end,{
  createFile(path,body){const text=String(body),point=stage(path,text);if(!injected&&(failure===point+"-write"||failure===point+"-file-sync")){const bytes=Buffer.from(text);writeFileSync(path,failure.endsWith("write")?bytes.subarray(0,Math.floor(bytes.length/2)):bytes,{mode:0o600});reject(failure);}createFile(path,body);last=point;},
  renameSync(from,to){const point=stage(String(from),readFileSync(from,"utf8"));reject(point+"-rename");renameSync(from,to);last=point;},
  unlinkSync(path){if(/\/[1-9][0-9]*-[a-f0-9-]{36}\.json$/.test(String(path))){reject("record-unlink");unlinkSync(path);last="unlink";}else unlinkSync(path);},
  syncDirectory(path){reject(last+"-dir-sync");syncDirectory(path);},
}));
