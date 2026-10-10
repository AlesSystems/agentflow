import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFile,syncDirectory } from "../../src/server/filesystem";
import { main } from "../../src/cli/main";
import { openOutbox } from "../../src/cli/outbox";
const [phase,...args]=process.argv.slice(2);
process.exitCode=await main(args,(config,end)=> {
  let advanced=false;
  return openOutbox(config,end,{
    createFile(path,value){if(path.endsWith("metadata.json.tmp")&&JSON.parse(String(value)).cursor!==null){if(phase==="create")throw new Error("fixture cursor write failure");advanced=true;}createFile(path,value);},
    syncDirectory(path){syncDirectory(path);if(advanced&&path===config.outbox&&JSON.parse(readFileSync(join(path,"metadata.json"),"utf8")).cursor!==null){advanced=false;if(phase==="sync")throw new Error("fixture cursor directory sync uncertainty");if(phase==="kill")process.kill(process.pid,"SIGKILL");}},
  }).then(box=>phase==="validation"?{...box,async next(id:string,until?:number){await new Promise(resolve=>setTimeout(resolve,500));return box.next(id,until);}}:box);
});
