import { readFileSync, renameSync } from "node:fs";
import { main } from "../../src/cli/main";
import { openOutbox } from "../../src/cli/outbox";
import { createFile } from "../../src/server/filesystem";
const [phase,...args]=process.argv.slice(2);
let published=false;
const crash=(point:string)=>{if(phase===point)process.kill(process.pid,"SIGKILL");};
process.exitCode=await main(args,(config,end)=>openOutbox(config,end,{
 createFile(path,body){createFile(path,body);if(path.endsWith("metadata.json.tmp")&&JSON.parse(String(body)).pendingRegistration)crash("descriptor-temp");},
 renameSync(from,to){renameSync(from,to);const path=String(to);if(path.endsWith("metadata.json")){const meta=JSON.parse(readFileSync(to,"utf8"));if(meta.pendingRegistration){published=true;crash("descriptor");}else if(published)crash("clear");}else if(/registration-[a-f0-9-]{36}\.json$/.test(path))crash("registration");else if(path.includes("/workflow-runs/")&&path.endsWith("state.json"))crash("authority");},
}));
