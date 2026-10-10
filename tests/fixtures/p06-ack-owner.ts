import { readFileSync,readSync,unlinkSync } from "node:fs";
import { cliConfig } from "../../src/cli/config";
import { openOutbox,type EventRecord } from "../../src/cli/outbox";
const [phase,path,generation]=process.argv.slice(2);
function control(){const byte=Buffer.alloc(1);for(;;){if(readSync(0,byte,0,1,null)!==1)throw Error("fixture controller closed");if(byte[0]===10)return;}}
const config=cliConfig(),record=JSON.parse(readFileSync(path,"utf8")) as EventRecord;
const box=await openOutbox(config,performance.now()+10000,{unlinkSync(file){unlinkSync(file);if(phase==="after"&&String(file).includes(String(record.body.eventId))){console.log("owner-held");control();}}});
try {console.log("ready");control();const result=await box.acknowledge(record,generation);console.log(JSON.stringify({result:result??null}));}finally{box.close();}
