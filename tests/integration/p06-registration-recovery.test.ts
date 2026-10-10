import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync,existsSync,readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { cliFixture } from "../fixtures/p06-cli";
import { publicProxy } from "../fixtures/p06-proxy";
async function setup(server: Awaited<ReturnType<typeof launch>>) {
  const f=cliFixture(server);
  async function create(args:string[],body:unknown){const result=await f.cli([...args,"--file",f.file(body),"--idempotency-key",randomUUID()]);expect(result.code).toBe(0);return JSON.parse(result.stdout).id as string;}
  const projectId=await create(["project","create"],{name:"Synthetic"});
  const taskId=await create(["task","create"],{projectId,title:"Synthetic"});
  const agentId=await create(["agent","register"],{displayName:"Synthetic",source:"fixture",defaultRole:"implementation"});
  const body={id:randomUUID().toUpperCase(),projectId,taskId,agentId,purpose:"implementation",expectedTaskVersion:1};
  return {...f,projectId,taskId,agentId,body};
}
it.each(["task","agent","run"])("fresh CLI replays a lost committed %s registration with the immutable original request",async kind=> {
  const server=await launch(),f=await setup(server);let lose=true;
  const route=kind==="task"?"/api/v1/tasks":kind==="agent"?"/api/v1/agents":"/api/v1/runs";
  const proxy=await publicProxy(server,(req,_body,reply)=>reply&&req.method==="POST"&&req.url===route&&lose?{drop:true}:undefined);
  const root=join(f.dir,"replay-outbox"),env={PORT:String(proxy.port),AGENTFLOW_OUTBOX_DIR:root};
  const body=kind==="task"?{projectId:f.projectId,title:"  PRIVATE-P06-TASK  "}:kind==="agent"?{displayName:"  PRIVATE-P06-AGENT  ",source:"  fixture  ",defaultRole:"reviewer"}:f.body;
  const key=randomUUID(),file=f.file(body),args=[kind,kind==="task"?"create":"register","--file",file,"--idempotency-key",key];
  try {
    const first=await f.cli(args,env);expect(first.code).toBe(2);expect(first.stdout+first.stderr).not.toContain("PRIVATE-P06");
    const journal=JSON.parse(readFileSync(join(root,`registration-${key}.json`),"utf8"));expect(journal.body).toEqual(body);
    if(kind==="agent")expect(journal.body).not.toHaveProperty("id");
    lose=false;const replay=await f.cli(args,env);expect(replay.code).toBe(0);expect(Object.keys(JSON.parse(replay.stdout)).sort()).toEqual(["generation","id"]);
    const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});
    try{const table=kind==="task"?"tasks":kind==="agent"?"agents":"runs";expect(db.prepare(`SELECT count(*) n FROM ${table}`).get()).toEqual({n:kind==="run"?1:2});if(kind==="run")expect(db.prepare("SELECT version,work_revision FROM tasks WHERE id=?").get(f.taskId)).toEqual({version:2,work_revision:2});}finally{db.close();}
    expect(existsSync(join(root,`registration-${key}.json`))).toBe(false);
  }finally{await proxy.close();await server.stop();}
});

it.each(["init-write","init-file-sync","init-rename","init-dir-sync"])("retains run journal through %s failure and same-key replay finishes initialization once",async point=> {
  const server=await launch(),f=await setup(server),key=randomUUID(),file=f.file(f.body),args=["run","register","--file",file,"--idempotency-key",key];
  try {
    const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-fault-cli.ts",point,...args],{env:{...process.env,...f.env},stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);
    expect(await new Promise(resolve=>child.on("exit",resolve))).toBe(1);expect(stdout).toBe("");expect(stderr).not.toContain("PRIVATE-P06-IO");
    const journalPath=join(f.env.AGENTFLOW_OUTBOX_DIR,`registration-${key}.json`),journal=JSON.parse(readFileSync(journalPath,"utf8"));expect(journal.body).toEqual(f.body);
    const replay=await f.cli(args);expect(replay.code).toBe(0);
    expect(existsSync(journalPath)).toBe(false);expect(JSON.parse(readFileSync(join(f.env.AGENTFLOW_OUTBOX_DIR,f.body.id.toLowerCase(),"state.json"),"utf8"))).toMatchObject({allocatedThrough:0,acknowledgedThrough:0});
    const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT count(*) n FROM runs").get()).toEqual({n:1});expect(db.prepare("SELECT version,work_revision FROM tasks WHERE id=?").get(f.taskId)).toEqual({version:2,work_revision:2});}finally{db.close();}
  }finally{await server.stop();}
});

it("keeps a registration queued through failed current GET and ignores historical zero after current sequence advances",async()=> {
  const server=await launch(),f=await setup(server);let unavailable=true,advanced=false;
  const proxy=await publicProxy(server,async(req,_body,reply)=> {
    if(!reply&&req.method==="GET"&&req.url?.startsWith("/api/v1/runs/")&&unavailable)return{status:503,body:"{}",headers:{"Retry-After":"1"}};
    if(reply&&req.method==="POST"&&req.url==="/api/v1/runs"&&!unavailable&&!advanced){advanced=true;const result=await fetch(server.url+`/api/v1/runs/${f.body.id}/events`,{method:"POST",headers:{Authorization:`Bearer ${server.credentials().reporterToken}`,"Content-Type":"application/json"},body:JSON.stringify({schemaVersion:1,eventId:randomUUID(),runId:f.body.id,sequence:1,type:"run.started",occurredAt:"2026-10-10T00:00:00.000Z",payload:{}})});expect(result.status).toBe(201);}
    return undefined;
  });
  const root=join(f.dir,"get-outbox"),env={PORT:String(proxy.port),AGENTFLOW_OUTBOX_DIR:root},key=randomUUID(),args=["run","register","--file",f.file(f.body),"--idempotency-key",key];
  try {
    expect((await f.cli(args,env)).code).toBe(2);
    const journalPath=join(root,`registration-${key}.json`),original=readFileSync(journalPath);expect(existsSync(join(root,f.body.id.toLowerCase(),"state.json"))).toBe(false);
    unavailable=false;const blocked=await f.cli(args,env);expect(blocked.code).toBe(3);expect(blocked.stderr).toContain("producer_state_required");expect(readFileSync(journalPath)).toEqual(original);expect(existsSync(join(root,f.body.id.toLowerCase(),"state.json"))).toBe(false);
    const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT last_sequence,version FROM runs").get()).toEqual({last_sequence:1,version:2});expect(db.prepare("SELECT version,work_revision FROM tasks WHERE id=?").get(f.taskId)).toEqual({version:3,work_revision:2});}finally{db.close();}
    expect(readdirSync(root).filter(name=>name.startsWith("registration-")).length).toBe(1);
  }finally{await proxy.close();await server.stop();}
});

it.each(["registration-descriptor-write","registration-descriptor-file-sync","registration-descriptor-rename","registration-descriptor-dir-sync","registration-write","registration-file-sync","registration-rename","registration-dir-sync","registration-clear-write","registration-clear-rename","registration-clear-dir-sync"])("retains registration identity through %s and fresh replay commits once",async point=> {
  const server=await launch(),f=await setup(server),key=randomUUID(),body={name:"  PRIVATE-P06-REGISTRATION-IDENTITY  "},file=f.file(body),args=["project","create","--file",file,"--idempotency-key",key];
  try {
    const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-fault-cli.ts",point,...args],{env:{...process.env,...f.env},stdio:["ignore","pipe","pipe"]});let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);
    expect(await new Promise(resolve=>child.on("exit",resolve))).toBe(1);expect(stdout).toBe("");expect(stderr).not.toContain("PRIVATE-P06");
    const root=f.env.AGENTFLOW_OUTBOX_DIR,meta=JSON.parse(readFileSync(join(root,"metadata.json"),"utf8")),journalPath=join(root,`registration-${key}.json`);
    const retained=meta.pendingRegistration?.record||(existsSync(journalPath)?JSON.parse(readFileSync(journalPath,"utf8")):undefined);
    if(retained){expect(retained.key).toBe(key);expect(retained.path).toBe("/projects");expect(retained.body).toEqual(body);expect(retained.order).toBe(3);}
    const replay=await f.cli(args);expect(replay.code).toBe(0);expect(replay.stdout+replay.stderr).not.toContain("PRIVATE-P06");expect(existsSync(journalPath)).toBe(false);
    const db=new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});try{expect(db.prepare("SELECT count(*) n FROM projects").get()).toEqual({n:2});expect(db.prepare("SELECT count(*) n FROM receipts WHERE key=?").get(key)).toEqual({n:1});}finally{db.close();}
    expect(JSON.parse(readFileSync(join(root,"metadata.json"),"utf8")).nextOrder).toBe(4);
  }finally{await server.stop();}
});
