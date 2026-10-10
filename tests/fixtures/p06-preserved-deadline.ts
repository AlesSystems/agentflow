import { main } from "../../src/cli/main";
import { openOutbox } from "../../src/cli/outbox";
import { CliError } from "../../src/cli/config";
const [point,...args]=process.argv.slice(2);
process.exitCode=await main(args,async(config,end)=> {
  const outbox=await openOutbox(config,end);
  if(args[0]==="report")return{...outbox,next:async()=>{throw new CliError(point);}};
  return{...outbox,removeRegistration:async()=>{throw new CliError(point);}};
});
