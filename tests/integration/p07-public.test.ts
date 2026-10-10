import { expect,it } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { networkInterfaces } from "node:os";
import { connect } from "node:net";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
it("public invalid evidence links never mutate storage and the listener refuses this host's non-loopback interface",async()=>{
  const server=await launch();
  try{
    const f=await registeredRun(server),headers={Authorization:"Bearer "+server.credentials().reporterToken,"Content-Type":"application/json"};
    const body={schemaVersion:1,eventId:randomUUID(),runId:f.runId,sequence:1,type:"run.started",occurredAt:new Date().toISOString(),payload:{}};
    expect((await fetch(server.url+`/api/v1/runs/${f.runId}/events`,{method:"POST",headers,body:JSON.stringify(body)})).status).toBe(201);
    const rejected=[];
    for(const evidenceUrl of ["javascript:alert(1)","file:///synthetic/private","https://user:pass@example.com/synthetic"]){
      const response=await fetch(server.url+`/api/v1/runs/${f.runId}/events`,{method:"POST",headers,body:JSON.stringify({...body,eventId:randomUUID(),sequence:2,type:"run.succeeded",payload:{summary:"Synthetic invalid URL",evidenceUrl}})});
      rejected.push({status:response.status,body:await response.json()});expect(response.status).toBe(422);
    }
    const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT count(*) n FROM run_events WHERE run_id=?").get(f.runId)).toEqual({n:1});expect(db.prepare("SELECT state,last_sequence AS seq FROM runs WHERE id=?").get(f.runId)).toEqual({state:"running",seq:1});}finally{db.close();}
    const listener=execFileSync("lsof",["-nP","-a","-p",String(server.child.pid),"-iTCP","-sTCP:LISTEN"],{encoding:"utf8"});expect(listener).toContain(`127.0.0.1:${server.port}`);expect(listener).not.toContain(`*:${server.port}`);
    const address=Object.values(networkInterfaces()).flat().find(n=>n&&!n.internal&&n.family==="IPv4")?.address;
    const nonLoopback=address?await new Promise<string>(resolve=>{const socket=connect({host:address,port:server.port});socket.setTimeout(1000);socket.once("connect",()=>{socket.destroy();resolve("unexpected_connection");});socket.once("error",error=>resolve((error as NodeJS.ErrnoException).code??"error"));socket.once("timeout",()=>{socket.destroy();resolve("timeout");});}):"unavailable";
    expect(nonLoopback).not.toBe("unexpected_connection");
    if(process.env.AGENTFLOW_P07_EVIDENCE_DIR)writeFileSync(join(process.env.AGENTFLOW_P07_EVIDENCE_DIR,"public-private.json"),JSON.stringify({dir:server.dir,rejected,listener,address:address??null,nonLoopback},null,2),{mode:0o600});
  }finally{await server.stop();}
});
