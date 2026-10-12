import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { expect, it } from "vitest";
it("current_header_after_interleaved_prune and blocked SSE recover through the production native wire",async()=>{
 const child=spawn(process.execPath,["--import","tsx","tests/fixtures/w03b-generation.ts"],{stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);const timer=setTimeout(()=>child.kill("SIGKILL"),55000);const code=await new Promise(resolve=>child.once("close",resolve));clearTimeout(timer);if(process.env.W03B_TASK3_PROOF_DIR){writeFileSync(join(process.env.W03B_TASK3_PROOF_DIR,"native-generation.stdout"),stdout,{mode:0o600});writeFileSync(join(process.env.W03B_TASK3_PROOF_DIR,"native-generation.stderr"),stderr,{mode:0o600});}expect(code,stdout+stderr).toBe(0);expect(stdout).toContain('"cleanup"');expect(stdout).toContain('"stalledCloses":1');
},60000);

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { launch, pair } from "../fixtures/server";
const execute=promisify(execFile);
it("an actual stopped backup restore revokes the retained paired browser session",async()=>{
 let server=await launch();const cookie=await pair(server),backup=join(server.dir,"backups","task3-session.sqlite");
 try {
  await server.stop();
  for(const args of [["backup","--output",backup],["restore","--from",backup]]){
   const result=await execute(process.execPath,["--import","tsx","src/cli/local.ts",...args],{env:{...process.env,AGENTFLOW_DATA_DIR:server.dir,PORT:String(server.port)},timeout:15000});expect(result.stderr).toBe("");
  }
  server=await launch({dir:server.dir,port:server.port});
  const response=await fetch(server.url+"/api/v1/projects",{headers:{Cookie:cookie}});expect(response.status).toBe(401);expect((await response.json()).error.code).toBe("authentication_required");
  const fresh=await pair(server);expect((await fetch(server.url+"/api/v1/projects",{headers:{Cookie:fresh}})).status).toBe(200);
 }finally{await server.stop();}
},40000);
