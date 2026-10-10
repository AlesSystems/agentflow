import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync,readdirSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";
import { openOutbox } from "../../src/cli/outbox";
it("resends a validated retained entry when sequence_gap requests that exact entry",async()=> {
  const server=await launch();let gap=true;
  const proxy=await publicProxy(server,(req,body,reply)=>{if(!reply&&gap&&req.url?.endsWith("/events")){gap=false;return{status:409,body:JSON.stringify({error:{code:"sequence_gap",expectedSequence:JSON.parse(body.toString()).sequence}})};}});
  try{const f=await registeredRun({...server,port:proxy.port});const result=await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})]);expect(result.code).toBe(0);expect(JSON.parse(result.stdout).acceptedSequence).toBe(1);}finally{await proxy.close();await server.stop();}
});
it.each(["malformed","oversize","wrong-event","wrong-run","wrong-sequence","private-error","forbidden"])("preserves original event and sanitized streams after %s",async kind=> {
  const server=await launch();let reject=true;
  const proxy=await publicProxy(server,(req,_body,reply)=> {
    if(!reject||!req.url?.endsWith("/events"))return;
    if(!reply&&["private-error","forbidden"].includes(kind))return{status:kind==="forbidden"?403:409,body:JSON.stringify({error:{code:kind==="forbidden"?"human_required":"PRIVATE-P06-SERVER-CODE",message:"PRIVATE-P06-TEXT",repositoryPath:"PRIVATE-P06-PATH"}})};
    if(reply){if(kind==="malformed")return{status:200,body:"PRIVATE-P06-MALFORMED",headers:{"AgentFlow-Generation":reply.generation!}};if(kind==="oversize")return{status:200,body:"x".repeat(65537),headers:{"AgentFlow-Generation":reply.generation!}};
      const value=JSON.parse(reply.body.toString());if(kind==="wrong-event")value.data.eventId=randomUUID();if(kind==="wrong-run")value.data.runId=randomUUID();if(kind==="wrong-sequence")value.data.acceptedSequence++;
      return{status:200,body:JSON.stringify(value),headers:{"AgentFlow-Generation":reply.generation!}};}
  });
  try {
    const f=await registeredRun({...server,port:proxy.port}),result=await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})]);
    expect(result.code).toBe(3);expect(result.stdout).toBe("");expect(result.stderr).not.toContain("PRIVATE-P06");expect(result.stderr).not.toContain(server.dir);expect(result.stderr).not.toContain(server.credentials().reporterToken);
    const directory=join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId),name=readdirSync(directory).find(name=>/^1-/.test(name))!,original=readFileSync(join(directory,name));
    expect(JSON.parse(readFileSync(join(directory,"state.json"),"utf8")).acknowledgedThrough).toBe(0);
    reject=false;const flushed=await f.cli(["flush","--run",f.runId]);expect(flushed.code).toBe(0);expect(JSON.parse(flushed.stdout).eventId).toBe(JSON.parse(original.toString()).body.eventId);
  }finally{await proxy.close();await server.stop();}
});
it("refuses redirects without forwarding bearer or touching the redirect destination",async()=> {
  const server=await launch();let requests=0,bearer=false;
  const destination=createServer((req,res)=>{requests++;bearer=Boolean(req.headers.authorization);res.end("{}");});await new Promise<void>(resolve=>destination.listen(0,"127.0.0.1",resolve));const address=destination.address();if(!address||typeof address==="string")throw new Error("fixture address missing");
  const proxy=await publicProxy(server,(req,_body,reply)=>{if(!reply&&req.url?.endsWith("/events"))return{status:307,body:"",headers:{Location:`http://127.0.0.1:${address.port}/PRIVATE-P06-REDIRECT`}};});
  try{const f=await registeredRun({...server,port:proxy.port});const result=await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})]);expect(result.code).toBe(3);expect(result.stderr).toContain("redirect_refused");expect(result.stderr).not.toContain("PRIVATE-P06");expect({requests,bearer}).toEqual({requests:0,bearer:false});expect(readdirSync(join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId)).filter(name=>/^1-/.test(name))).toHaveLength(1);}finally{await proxy.close();await new Promise<void>(resolve=>destination.close(()=>resolve()));await server.stop();}
});
it.each(["authentication","external-advance","terminal"])("blocks actual production %s without overwriting retained producer state",async kind=> {
  const server=await launch();
  try {
    const f=await registeredRun(server),root=f.env.AGENTFLOW_OUTBOX_DIR;
    if(kind==="terminal"){expect((await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})])).code).toBe(0);expect((await f.cli(["report","--run",f.runId,"--type","run.succeeded","--payload",f.file({summary:"Synthetic"})])).code).toBe(0);}
    const box=await openOutbox({port:server.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined},performance.now()+5000);let record;
    try{record=await box.enqueue(f.runId,kind==="terminal"?"run.heartbeat":"run.started",{});}finally{box.close();}
    if(kind==="authentication")writeFileSync(f.env.AGENTFLOW_REPORTER_TOKEN_FILE,"b".repeat(64));
    if(kind==="external-advance")expect((await fetch(server.url+`/api/v1/runs/${f.runId}/events`,{method:"POST",headers:{Authorization:`Bearer ${server.credentials().reporterToken}`,"Content-Type":"application/json"},body:JSON.stringify({...record.body,eventId:randomUUID()})})).status).toBe(201);
    const before=readFileSync(join(root,f.runId,"state.json")),result=await f.cli(["flush","--run",f.runId]);expect(result.code).toBe(3);expect(readFileSync(join(root,f.runId,"state.json"))).toEqual(before);expect(result.stderr).toContain(kind==="authentication"?"authentication_required":kind==="terminal"?"run_terminal":"sequence_conflict");
  }finally{await server.stop();}
});
