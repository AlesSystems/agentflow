import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { main } from "../../src/cli/main";
import { openOutbox } from "../../src/cli/outbox";
const [phase,trace,...args] = process.argv.slice(2);
process.exitCode = await main(args, async (config,end) => {
  const box = await openOutbox(config,end);
  let turns=0;
  async function control<T>(operation:(budget:number)=>Promise<T>,until=end) {
    turns++;
    if(phase==="second-wait"&&turns===1)return operation(until);
    const entered=performance.now();
    const expired=(phase==="io"||phase==="rollback")?until!:phase!=="accounting"?entered-1:entered+1;
    const exec=Database.prototype.exec;
    let injected=false;
    if(phase==="io"||phase==="rollback")Database.prototype.exec=function(sql:string){if(!injected&&sql===(phase==="io"?"BEGIN EXCLUSIVE":"ROLLBACK")&&this.name.endsWith("publication.sqlite")){injected=true;throw new Database.SqliteError("fixture native SQLite IO failure","SQLITE_IOERR");}return exec.call(this,sql);};
    const clock=performance.now.bind(performance);
    if(phase==="accounting")performance.now=()=>new Error().stack?.includes("lengths")?entered+2:entered;
    try { return await operation(expired); }
    catch(error) { performance.now=clock; writeFileSync(trace,JSON.stringify({qualification:"new controlled reproduction, not historical failure stack",globalEnd:end,turnEnd:until,entered,forcedAdmissionEnd:expired,thrownAt:performance.now(),stack:error instanceof Error?error.stack:"unknown",cause:error instanceof Error&&error.cause instanceof Error?error.cause.stack:undefined})+"\n",{mode:0o600});throw error; } finally {performance.now=clock;Database.prototype.exec=exec;}
  }
  return {...box,advanceCursor:(id:string,until?:number)=>control(budget=>box.advanceCursor(id,budget),until),selectForTurn:(id:string,cursor:string,until?:number)=>control(budget=>box.selectForTurn(id,cursor,budget),until)};
});
