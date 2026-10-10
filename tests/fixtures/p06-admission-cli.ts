import { writeFileSync } from "node:fs";
import { main } from "../../src/cli/main";
import { openOutbox } from "../../src/cli/outbox";
const [phase,trace,...args] = process.argv.slice(2);
process.exitCode = await main(args, async (config,end) => {
  const box = await openOutbox(config,end);
  let turns=0;
  return { ...box, async advanceCursor(id:string,until?:number) {
    turns++;
    if(phase==="second-wait"&&turns===1)return box.advanceCursor(id,until);
    const entered=performance.now();
    const expired=phase!=="accounting"?entered-1:entered+1;
    const clock=performance.now.bind(performance);
    if(phase==="accounting")performance.now=()=>new Error().stack?.includes("lengths")?entered+2:entered;
    try { return await box.advanceCursor(id,expired); }
    catch(error) { performance.now=clock; writeFileSync(trace,JSON.stringify({qualification:"new controlled reproduction, not historical failure stack",globalEnd:end,turnEnd:until,entered,forcedAdmissionEnd:expired,thrownAt:performance.now(),stack:error instanceof Error?error.stack:"unknown",cause:error instanceof Error&&error.cause instanceof Error?error.cause.stack:undefined})+"\n",{mode:0o600});throw error; } finally {performance.now=clock;}
  } };
});
