import { readFileSync,readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";
import { openOutbox } from "../../src/cli/outbox";
it.each([429,503])("honors %s Retry-After without delaying another eligible run",async status=> {
  const server=await launch();let delayed="";const attempts:number[]=[],order:string[]=[];
  const proxy=await publicProxy(server,(req,_body,reply)=>{if(!reply&&req.url?.endsWith("/events")){order.push(req.url);if(req.url.includes(delayed)){attempts.push(performance.now());return{status,body:"",headers:{"Retry-After":"2"}};}}});
  try {
    const f=await registeredRun({...server,port:proxy.port});delayed=f.runId;
    const registration=await f.cli(["run","register","--file",f.file({id:randomUUID(),projectId:f.projectId,agentId:f.agentId,purpose:"planning"}),"--idempotency-key",randomUUID()]);expect(registration.code).toBe(0);const healthy=JSON.parse(registration.stdout).id;
    const root=f.env.AGENTFLOW_OUTBOX_DIR,box=await openOutbox({port:proxy.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined},performance.now()+5000);try{await box.enqueue(delayed,"run.started",{});await box.enqueue(healthy,"run.started",{});}finally{box.close();}
    const original=readFileSync(join(root,delayed,readdirSync(join(root,delayed)).find(name=>/^1-/.test(name))!));
    const start=performance.now();expect((await f.cli(["flush"])).code).toBe(2);expect(performance.now()-start).toBeLessThan(5700);
    expect(attempts.length).toBeGreaterThanOrEqual(2);expect(attempts.length).toBeLessThanOrEqual(3);
    expect(attempts.slice(1).every((at,i)=>at-attempts[i]>=1950)).toBe(true);expect(order.slice(0,2)).toContain(`/api/v1/runs/${healthy}/events`);
    expect(JSON.parse(readFileSync(join(root,healthy,"state.json"),"utf8")).acknowledgedThrough).toBe(1);expect(readFileSync(join(root,delayed,readdirSync(join(root,delayed)).find(name=>/^1-/.test(name))!))).toEqual(original);
  }finally{await proxy.close();await server.stop();}
});
it("bounds current-GET validation within the same event turn and preserves its committed original",async()=> {
  const server=await launch();let delay=false;const elapsed:number[]=[];
  const changed=randomUUID();
  const proxy=await publicProxy(server,async(req,_body,reply)=> {
    if(delay&&req.method==="GET"&&/\/runs\/[^/]+$/.test(req.url??"")){const start=performance.now();req.socket.once("close",()=>elapsed.push(performance.now()-start));await new Promise(resolve=>setTimeout(resolve,1000));return{status:503,body:""};}
    if(reply&&req.url?.endsWith("/events"))return{status:reply.status,body:reply.body.toString(),headers:{"AgentFlow-Generation":changed}};
  });
  try {
    const f=await registeredRun({...server,port:proxy.port});delay=true;
    const result=await f.cli(["report","--run",f.runId,"--type","run.started","--payload",f.file({})]);expect(result.code).toBe(2);
    const directory=join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId),name=readdirSync(directory).find(name=>/^1-/.test(name))!,original=readFileSync(join(directory,name));
    expect(elapsed.length).toBeGreaterThan(1);expect(elapsed.every(ms=>ms<550)).toBe(true);
    delay=false;expect((await f.cli(["flush","--run",f.runId])).code).toBe(0);expect(JSON.parse(original.toString()).body.sequence).toBe(1);
  }finally{await proxy.close();await server.stop();}
});
