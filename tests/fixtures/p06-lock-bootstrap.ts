import { existsSync, lstatSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createFile, syncDirectory } from "../../src/server/filesystem";
import { main } from "../../src/cli/main";
import { openOutbox } from "../../src/cli/outbox";
const [phase,...args]=process.argv.slice(2);
function crash(point: string){if(phase===point)process.kill(process.pid,"SIGKILL");}
process.exitCode=await main(args,(config,end)=>openOutbox(config,end,{
  createFile(path,body){createFile(path,body);if(path.endsWith("publication.sqlite"))crash("created");},
  renameSync,unlinkSync,
  syncDirectory(path){syncDirectory(path);const publication=join(config.outbox,"publication.sqlite"),delivery=join(config.outbox,"delivery.sqlite");if(existsSync(publication)&&lstatSync(publication).size===4096&&existsSync(delivery)&&lstatSync(delivery).size===0)crash("first-initialized");},
}));
