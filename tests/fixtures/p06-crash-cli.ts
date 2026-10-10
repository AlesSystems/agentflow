import { readFileSync, renameSync, unlinkSync } from "node:fs";
import { createFile, syncDirectory } from "../../src/server/filesystem";
import { main } from "../../src/cli/main";
import { openOutbox } from "../../src/cli/outbox";
const [phase,...args] = process.argv.slice(2);
function crash(point: string) {if(phase===point) process.kill(process.pid,"SIGKILL");}
process.exitCode = await main(args,(config,end)=>openOutbox(config,end,{
  createFile(path,body){createFile(path,body);if(path.endsWith("state.json.tmp") && JSON.parse(String(body)).pending) crash("descriptor-temp");},
  renameSync(from,to){renameSync(from,to);if(String(to).endsWith("state.json")){const state=JSON.parse(readFileSync(to,"utf8"));if(state.pending)crash("descriptor");else if(state.acknowledgedThrough===1)crash("ack");else if(state.allocatedThrough===1)crash("clear");}else if(/\/1-/.test(String(to)))crash("record");else if(String(to).endsWith("metadata.json") && JSON.parse(readFileSync(to,"utf8")).cursor)crash("cursor");},
  unlinkSync(path){unlinkSync(path);if(/\/1-/.test(String(path)))crash("unlink");},
  syncDirectory,
}));
