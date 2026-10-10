import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { readFileSync,lstatSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";
import { openOutbox } from "../../src/cli/outbox";
it.each(["SQLITE_IOERR","forged","SQLITE_BUSY","SQLITE_LOCKED","owner"])("classifies delivery BEGIN %s and preserves exact work for fresh recovery",async mode=>{
 const server=await launch(),posts:string[]=[];
 const proxy=await publicProxy(server,(req,_body,reply)=>{if(!reply&&req.url?.endsWith("/events")&&req.method==="POST")posts.push(req.url);return undefined;});
 const f=await registeredRun({...server,port:proxy.port});let owner:Database.Database|undefined;
 try{
  const box=await openOutbox({port:proxy.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined},performance.now()+5000);let event;
  try{event=await box.enqueue(f.runId,"run.started",{});}finally{box.close();}
  const record=join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId,`1-${event.body.eventId}.json`),state=join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId,"state.json"),lock=join(f.env.AGENTFLOW_OUTBOX_DIR,"delivery.sqlite");
  const bytes=readFileSync(record),watermarks=readFileSync(state),identity=lstatSync(lock);
  if(mode==="owner"){owner=new Database(lock);owner.exec("BEGIN EXCLUSIVE");}
  const child=spawn(process.execPath,["--import","tsx",mode==="owner"?"src/cli/main.ts":"tests/fixtures/p06-delivery-error.ts",...(mode==="owner"?[]:[mode]),"flush","--run",f.runId],{env:{...process.env,...f.env},stdio:["ignore","pipe","pipe"]});
  let stdout="",stderr="";child.stdout.on("data",c=>stdout+=c);child.stderr.on("data",c=>stderr+=c);
  const code=await new Promise(resolve=>child.once("exit",resolve));
  expect(code,stderr).toBe(["SQLITE_IOERR","forged"].includes(mode)?1:2);expect(stdout).toBe("");expect(stderr).not.toContain("private ");expect(stderr).not.toContain(server.credentials().reporterToken);
  expect(posts).toEqual([]);expect(readFileSync(record)).toEqual(bytes);expect(readFileSync(state)).toEqual(watermarks);expect(JSON.parse(watermarks.toString())).toMatchObject({allocatedThrough:1,acknowledgedThrough:0});
  expect(lstatSync(lock).ino).toBe(identity.ino);expect(lstatSync(lock).dev).toBe(identity.dev);
  if(owner){owner.exec("ROLLBACK");owner.close();owner=undefined;}
  const recovered=await f.cli(["flush","--run",f.runId]);expect(recovered.code,recovered.stderr).toBe(0);expect(posts).toHaveLength(1);
  const headers={Authorization:"Bearer "+server.credentials().reporterToken};
  const response=await(await fetch(server.url+`/api/v1/runs/${f.runId}/events`,{headers})).json();
  expect(response.data.items).toHaveLength(1);expect(response.data.items[0]).toMatchObject(event.body);
  expect(JSON.parse(readFileSync(state,"utf8"))).toMatchObject({allocatedThrough:1,acknowledgedThrough:1});
  if(process.env.AGENTFLOW_P06_EVIDENCE_DIR)writeFileSync(join(process.env.AGENTFLOW_P06_EVIDENCE_DIR,`delivery-${mode}-${f.runId}.json`),JSON.stringify({mode,code,stdout,stderr,record:JSON.parse(bytes.toString()),originalBytes:bytes.toString("base64"),watermarks:JSON.parse(watermarks.toString()),recovery:recovered,stored:response.data.items,lock:{dev:identity.dev,ino:identity.ino},owned:[server.dir,f.dir]},null,2),{mode:0o600});
 }finally{if(owner){owner.exec("ROLLBACK");owner.close();}await proxy.close();await server.stop();}
});
