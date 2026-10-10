import { randomUUID } from "node:crypto";
import { readFileSync,readdirSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";
import { openOutbox } from "../../src/cli/outbox";

it("continues a durable ring beyond ten slow runs and unrelated/dependent registrations",async()=> {
  const server=await launch(),slow=new Set<string>(),attempts:string[]=[];let dependent=0;
  const agentId=randomUUID(),dependentRun=randomUUID();
  const proxy=await publicProxy(server,async(req,body,reply)=> {
    if(reply)return;
    if(req.method==="POST"&&req.url==="/api/v1/runs"&&JSON.parse(body.toString()).id===dependentRun){dependent++;return{status:503,body:""};}
    if(req.method==="POST"&&(req.url==="/api/v1/projects"||req.url==="/api/v1/agents")&&JSON.parse(body.toString()).name==="Pending"||req.method==="POST"&&req.url==="/api/v1/agents"&&JSON.parse(body.toString()).id===agentId){attempts.push("registration");await new Promise(resolve=>setTimeout(resolve,1000));return{status:503,body:""};}
    const id=req.url?.match(/\/runs\/([^/]+)\/events$/)?.[1];
    if(id){attempts.push(id);if(slow.has(id)){await new Promise(resolve=>setTimeout(resolve,1000));return{status:503,body:""};}}
  });
  try {
    const f=await registeredRun({...server,port:proxy.port});
    const config={port:proxy.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined};
    const outbox=await openOutbox(config,performance.now()+20000),ids:string[]=[];
    try {
      for(let i=0;i<12;i++) {
        const id=`00000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`;
        const response=await fetch(server.url+"/api/v1/runs",{method:"POST",headers:{Authorization:`Bearer ${config.token}`,"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify({id,projectId:f.projectId,agentId:f.agentId,purpose:"planning"})});expect(response.status).toBe(201);
        expect((await outbox.initializeRun(id)).kind).toBe("delivered");await outbox.enqueue(id,"run.started",{});ids.push(id);slow.add(id);
      }
      const id="ffffffff-ffff-4fff-bfff-ffffffffffff";
      const response=await fetch(server.url+"/api/v1/runs",{method:"POST",headers:{Authorization:`Bearer ${config.token}`,"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify({id,projectId:f.projectId,agentId:f.agentId,purpose:"planning"})});expect(response.status).toBe(201);
      expect((await outbox.initializeRun(id)).kind).toBe("delivered");await outbox.enqueue(id,"run.started",{});ids.push(id);
      await outbox.preserveRegistration("/projects",randomUUID(),{name:"Pending"});
      await outbox.preserveRegistration("/agents",randomUUID(),{id:agentId,displayName:"Pending",source:"fixture",defaultRole:"implementation"});
      await outbox.preserveRegistration("/runs",randomUUID(),{id:dependentRun,projectId:f.projectId,agentId,purpose:"planning"});
    }finally{outbox.close();}
    const originals=ids.slice(0,12).map(id=>readFileSync(join(config.outbox,id,readdirSync(join(config.outbox,id)).find(name=>/^1-/.test(name))!)));
    for(let i=0;i<2;i++){const start=performance.now();expect((await f.cli(["flush"])).code).toBe(2);expect(performance.now()-start).toBeLessThan(5700);if(i===0)expect(JSON.parse(readFileSync(join(config.outbox,ids[12],"state.json"),"utf8")).acknowledgedThrough).toBe(0);}
    expect(JSON.parse(readFileSync(join(config.outbox,ids[12],"state.json"),"utf8")).acknowledgedThrough).toBe(1);
    expect(dependent).toBe(0);expect(attempts.indexOf(ids[12])).toBeLessThanOrEqual(14);
    for(const [i,id]of ids.slice(0,12).entries())expect(readFileSync(join(config.outbox,id,readdirSync(join(config.outbox,id)).find(name=>/^1-/.test(name))!))).toEqual(originals[i]);
    expect(JSON.parse(readFileSync(join(config.outbox,"metadata.json"),"utf8")).cursor).toBeTruthy();
  }finally{await proxy.close();await server.stop();}
});

it("continues independent work after a blocked run and prints only safe error fields",async()=> {
  const server=await launch();let blocked="",delayed="";
  const proxy=await publicProxy(server,(req,_body,reply)=>{if(!reply&&req.url===`/api/v1/runs/${blocked}/events`)return{status:409,body:JSON.stringify({error:{code:"sequence_conflict",details:{expectedSequence:9,currentVersion:12},message:"PRIVATE-P06-ERROR",repositoryPath:"PRIVATE-P06-PATH"}})};if(!reply&&delayed&&req.url===`/api/v1/runs/${delayed}/events`)return{status:503,body:"",headers:{"Retry-After":"2"}};if(!reply&&req.method==="POST"&&req.url==="/api/v1/projects"&&JSON.parse(_body.toString()).name==="Blocked synthetic")return{status:403,body:JSON.stringify({error:{code:"human_required",message:"Synthetic rejection"}})};});
  try {
    const f=await registeredRun({...server,port:proxy.port});blocked=f.runId;
    const second=await f.cli(["run","register","--file",f.file({id:randomUUID(),projectId:f.projectId,agentId:f.agentId,purpose:"planning"}),"--idempotency-key",randomUUID()]);expect(second.code).toBe(0);const healthy=JSON.parse(second.stdout).id;
    const pending=await f.cli(["run","register","--file",f.file({id:randomUUID(),projectId:f.projectId,agentId:f.agentId,purpose:"planning"}),"--idempotency-key",randomUUID()]);expect(pending.code).toBe(0);delayed=JSON.parse(pending.stdout).id;
    const box=await openOutbox({port:proxy.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined},performance.now()+5000);
    const blockedKey=randomUUID();
    try{await box.enqueue(blocked,"run.started",{});await box.enqueue(healthy,"run.started",{});await box.enqueue(delayed,"run.started",{});await box.preserveRegistration("/projects",blockedKey,{name:"Blocked synthetic"});}finally{box.close();}
    const journal=join(f.env.AGENTFLOW_OUTBOX_DIR,`registration-${blockedKey}.json`),originalJournal=readFileSync(journal);
    const result=await f.cli(["flush"]);expect(result.code).toBe(3);
    expect(readFileSync(journal)).toEqual(originalJournal);expect(result.stderr).toContain("human_required");
    expect(result.stderr).toContain('"expectedSequence":9');expect(result.stderr).toContain('"currentVersion":12');expect(result.stderr).not.toContain("PRIVATE-P06");
    expect(JSON.parse(readFileSync(join(f.env.AGENTFLOW_OUTBOX_DIR,healthy,"state.json"),"utf8")).acknowledgedThrough).toBe(1);
    expect(JSON.parse(readFileSync(join(f.env.AGENTFLOW_OUTBOX_DIR,delayed,"state.json"),"utf8")).acknowledgedThrough).toBe(0);
  }finally{await proxy.close();await server.stop();}
});

it("gives an expired retry its ring turn while another run still has a healthy FIFO backlog",async()=> {
  const server=await launch(),a="00000000-0000-4000-8000-000000000001",b="ffffffff-ffff-4fff-bfff-ffffffffffff",order:string[]=[];let attemptsB=0;
  const proxy=await publicProxy(server,async(req,_body,reply)=> {
    if(reply||!req.url?.endsWith("/events"))return;
    const id=req.url.split("/").at(-2)!;order.push(id);
    if(id===b&&++attemptsB===1)return{status:503,body:"",headers:{"Retry-After":"0"}};
    if(id===a)await new Promise(resolve=>setTimeout(resolve,80));
  });
  try {
    const f=await registeredRun({...server,port:proxy.port}),root=f.env.AGENTFLOW_OUTBOX_DIR,config={port:proxy.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined};
    const box=await openOutbox(config,performance.now()+20000);
    try {
      for(const id of [a,b]){expect((await fetch(server.url+"/api/v1/runs",{method:"POST",headers:{Authorization:`Bearer ${config.token}`,"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify({id,projectId:f.projectId,agentId:f.agentId,purpose:"planning"})})).status).toBe(201);expect((await box.initializeRun(id)).kind).toBe("delivered");}
      for(let i=0;i<100;i++)await box.enqueue(a,i?"run.heartbeat":"run.started",{});await box.enqueue(b,"run.started",{});
    }finally{box.close();}
    const originals=new Map(readdirSync(join(root,a)).filter(name=>/^\d+-/.test(name)).map(name=>[name,readFileSync(join(root,a,name))]));
    const firstB=readdirSync(join(root,b)).find(name=>/^1-/.test(name))!,originalB=JSON.parse(readFileSync(join(root,b,firstB),"utf8"));
    expect((await f.cli(["flush"])).code).toBe(2);
    const stateA=JSON.parse(readFileSync(join(root,a,"state.json"),"utf8"));expect(stateA.acknowledgedThrough).toBeGreaterThan(0);expect(stateA.acknowledgedThrough).toBeLessThan(100);
    expect(JSON.parse(readFileSync(join(root,b,"state.json"),"utf8")).acknowledgedThrough).toBe(1);expect(attemptsB).toBe(2);expect(order.lastIndexOf(b)).toBeLessThanOrEqual(5);
    for(const name of readdirSync(join(root,a)).filter(name=>/^\d+-/.test(name)))expect(readFileSync(join(root,a,name))).toEqual(originals.get(name));
    const {default:Database}=await import("better-sqlite3"),db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT event_id FROM run_events WHERE run_id=?").get(b)).toEqual({event_id:originalB.body.eventId});const committed=db.prepare("SELECT event_id,sequence,digest,occurred_at FROM run_events WHERE run_id=? ORDER BY sequence").all(a) as {event_id:string;sequence:number;digest:string;occurred_at:number}[];expect(committed.length).toBeGreaterThanOrEqual(stateA.acknowledgedThrough);expect(committed.length).toBeLessThanOrEqual(stateA.acknowledgedThrough+1);const expected=[...originals.values()].map(bytes=>JSON.parse(bytes.toString())).filter(record=>record.body.sequence<=committed.length).sort((left,right)=>left.body.sequence-right.body.sequence).map(record=>({event_id:record.body.eventId,sequence:record.body.sequence,digest:record.digest,occurred_at:Date.parse(record.body.occurredAt)}));expect(committed).toEqual(expected);if(committed.length>stateA.acknowledgedThrough){const tail=committed.at(-1)!,name=`${tail.sequence}-${tail.event_id}.json`;expect(readFileSync(join(root,a,name))).toEqual(originals.get(name));}}finally{db.close();}
  }finally{await proxy.close();await server.stop();}
});
