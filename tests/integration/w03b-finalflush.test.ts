import { spawn } from "node:child_process";
import { expect, it } from "vitest";
it("releases the actual native final flush on deadline, shutdown, abort races and caller close",async()=>{
 const child=spawn(process.execPath,["--import","tsx","tests/fixtures/w03b-finalflush.ts"],{stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";
 child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);const timer=setTimeout(()=>child.kill("SIGKILL"),20000);
 const exit=await new Promise<number|null>(resolve=>child.once("close",resolve));clearTimeout(timer);expect(exit,stdout+stderr).toBe(0);
 for(const mode of ["deadline","closing","closingDuringEnd","closingBeforeEnd","callerAbort"])expect(stdout).toContain(`"mode":"${mode}"`);
 expect(stdout).not.toContain('"released":false');
},25000);
