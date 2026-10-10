import {startRuntime} from "../../src/server/launcher";
import {readConfig} from "../../src/server/config";
import {createInterface} from "node:readline";
import {profile} from "./p07-diagnostic-profile";
const running=await startRuntime(readConfig(process.env,"production"));
let finish:(()=>Promise<unknown>)|undefined;
createInterface({input:process.stdin}).on("line",line=>{void(async()=>{
 const command=JSON.parse(line) as {action:string;path:string};
 if(command.action==="start")finish=await profile(command.path,()=>({runtime:running.diagnostics(),streams:running.streams.diagnostics()}));
 const result=command.action==="end"?await finish!():{ms:performance.now(),wallMs:Date.now()};
 console.log("DIAGNOSTIC "+JSON.stringify({action:command.action,result}));
 })().catch(error=>{console.error(error);process.exitCode=1;});});
process.once("SIGTERM",()=>void running.shutdown().then(()=>process.exit(0)));
