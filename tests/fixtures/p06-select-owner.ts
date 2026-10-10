import { readFileSync,readSync } from "node:fs";
import { join } from "node:path";
import { cliConfig } from "../../src/cli/config";
import { openOutbox } from "../../src/cli/outbox";
import { createFile } from "../../src/server/filesystem";
const [phase,runId]=process.argv.slice(2);
function control(){const byte=Buffer.alloc(1);for(;;){if(readSync(0,byte,0,1,null)!==1)throw Error("fixture controller closed");if(byte[0]===10)return;}}
const config=cliConfig(),box=await openOutbox(config,performance.now()+10000,{createFile(path,body){if(path.endsWith("metadata.json.tmp")&&JSON.parse(String(body)).cursor){console.log(JSON.stringify({ownerState:JSON.parse(readFileSync(join(config.outbox,runId,"state.json"),"utf8"))}));if(phase==="after")control();}createFile(path,body);}});
try{console.log("ready");control();const record=await box.selectForTurn(runId,`run:${runId}`);console.log(JSON.stringify({record}));}finally{box.close();}
