import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect,it } from "vitest";
import { launch } from "../fixtures/server";
import { registeredRun } from "../fixtures/p06-cli";
import { seedRunToBytes,logicalBytes,RUN_BYTES } from "../fixtures/p06-quota";
import { openOutbox } from "../../src/cli/outbox";
import { canonicalDigest } from "../../src/domain/request-digest";
it("charges registration metadata globally and permits a run journal that exactly fits its own run ceiling",async()=> {
  const server=await launch(),f=await registeredRun(server);
  try {
    const key=randomUUID(),body={id:f.runId,projectId:f.projectId,agentId:f.agentId,purpose:"planning"};
    const meta=JSON.parse(readFileSync(join(f.env.AGENTFLOW_OUTBOX_DIR,"metadata.json"),"utf8"));
    const journal={formatVersion:1,key,path:"/runs",body,digest:canonicalDigest(body),order:meta.nextOrder};
    const journalBytes=Buffer.byteLength(JSON.stringify(journal));
    seedRunToBytes(f.env.AGENTFLOW_OUTBOX_DIR,f.runId,RUN_BYTES-journalBytes);
    const outbox=await openOutbox({port:server.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined},performance.now()+5000);
    try {expect(await outbox.preserveRegistration("/runs",key,body)).toEqual(journal);}finally{outbox.close();}
    expect(logicalBytes(join(f.env.AGENTFLOW_OUTBOX_DIR,f.runId))+readFileSync(join(f.env.AGENTFLOW_OUTBOX_DIR,`registration-${key}.json`)).length).toBe(RUN_BYTES);
  } finally{await server.stop();}
});

it.each(["partial","complete"])("attributes a %s interrupted run-registration temp and recovers the unchanged original journal at the exact run ceiling",async phase=> {
  const {createFile,syncDirectory}=await import("../../src/server/filesystem");
  const {renameSync,unlinkSync,writeFileSync,readdirSync,lstatSync}=await import("node:fs");
  const server=await launch(),f=await registeredRun(server);
  try {
    const key=randomUUID(),body={id:f.runId.toUpperCase(),projectId:f.projectId,agentId:f.agentId,purpose:"planning",model:"  Synthetic  "};
    const meta=JSON.parse(readFileSync(join(f.env.AGENTFLOW_OUTBOX_DIR,"metadata.json"),"utf8"));
    const journal={formatVersion:1,key,path:"/runs",body,digest:canonicalDigest(body),order:meta.nextOrder};
    const size=Buffer.byteLength(JSON.stringify(journal));
    seedRunToBytes(f.env.AGENTFLOW_OUTBOX_DIR,f.runId,RUN_BYTES-size);
    const samples:number[]=[];
    let fail=true;
    const config={port:server.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined};
    const outbox=await openOutbox(config,performance.now()+5000,{createFile(path,value){if(fail && path.endsWith(`registration-${key}.json.tmp`)){fail=false;const bytes=Buffer.from(String(value));writeFileSync(path,phase==="partial"?bytes.subarray(0,Math.floor(bytes.length/2)):bytes,{mode:0o600});samples.push(logicalBytes(join(config.outbox,f.runId))+lstatSync(path).size);throw new Error("fixture registration interrupted");}createFile(path,value);},renameSync,unlinkSync,syncDirectory});
    try {await expect(outbox.preserveRegistration("/runs",key,body)).rejects.toThrow("fixture registration interrupted");}finally{outbox.close();}
    const descriptor=JSON.parse(readFileSync(join(config.outbox,"metadata.json"),"utf8"));
    expect(descriptor.pendingRegistration.record).toEqual(journal);
    const recovered=await openOutbox(config,performance.now()+5000);
    try {expect(await recovered.preserveRegistration("/runs",key,body)).toEqual(journal);}finally{recovered.close();}
    expect(JSON.parse(readFileSync(join(config.outbox,`registration-${key}.json`),"utf8"))).toEqual(journal);
    expect(logicalBytes(join(config.outbox,f.runId))+readFileSync(join(config.outbox,`registration-${key}.json`)).length).toBe(RUN_BYTES);
    expect(samples.every(bytes=>bytes<=RUN_BYTES)).toBe(true);
    expect(readdirSync(config.outbox).filter(name=>name.endsWith(".tmp"))).toEqual([]);
  } finally{await server.stop();}
});

it("recovers a descriptor-owned event temp whose partial write ends inside a UTF-8 character",async()=> {
  const {createFile,syncDirectory}=await import("../../src/server/filesystem");
  const {renameSync,unlinkSync,writeFileSync}=await import("node:fs");
  const server=await launch(),f=await registeredRun(server);
  const config={port:server.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined};
  let fail=true;
  try {
    const outbox=await openOutbox(config,performance.now()+5000,{createFile(path,value){if(fail && /\/1-/.test(path)){fail=false;const bytes=Buffer.from(String(value));const cut=bytes.indexOf(Buffer.from("é"))+1;writeFileSync(path,bytes.subarray(0,cut),{mode:0o600});throw Object.assign(new Error("fixture ENOSPC"),{code:"ENOSPC"});}createFile(path,value);},renameSync,unlinkSync,syncDirectory});
    try {await expect(outbox.enqueue(f.runId,"run.progress",{message:"é"})).rejects.toThrow("fixture ENOSPC");}finally{outbox.close();}
    const before=JSON.parse(readFileSync(join(config.outbox,f.runId,"state.json"),"utf8"));
    const recovered=await openOutbox(config,performance.now()+5000);
    try {expect((await recovered.next(f.runId))!.body).toEqual(before.pending.record.body);}finally{recovered.close();}
  } finally{await server.stop();}
});

it.each(["descriptor","partial-record","record-temp","record","partial-state","state-temp"])("rejects oversized sparse metadata before recovery at the logical global ceiling after %s",async phase=> {
  const {createFile,syncDirectory}=await import("../../src/server/filesystem");
  const {renameSync,unlinkSync,writeFileSync,openSync,ftruncateSync,closeSync}=await import("node:fs");
  const server=await launch(),f=await registeredRun(server);
  const root=f.env.AGENTFLOW_OUTBOX_DIR,directory=join(root,f.runId),statePath=join(directory,"state.json");
  try {
    const old=JSON.parse(readFileSync(statePath,"utf8"));
    const body={schemaVersion:1,eventId:randomUUID(),runId:f.runId,sequence:1,type:"run.started",occurredAt:"2026-10-10T00:00:00.000Z",payload:{}};
    const record={formatVersion:1,body,digest:canonicalDigest(body)},clean={...old,allocatedThrough:1};
    const recordText=JSON.stringify(record),stateText=JSON.stringify(clean),filename=`1-${body.eventId}.json`;
    const descriptor={...clean,pending:{record,filename,remainingPeak:Buffer.byteLength(recordText)+Buffer.byteLength(stateText)}};
    writeFileSync(statePath,JSON.stringify(descriptor));
    let credit=0;
    if(phase==="partial-record"||phase==="record-temp"){const bytes=Buffer.from(recordText),copy=phase==="partial-record"?bytes.subarray(0,Math.floor(bytes.length/2)):bytes;writeFileSync(join(directory,filename+".tmp"),copy,{mode:0o600});credit+=copy.length;}
    if(["record","partial-state","state-temp"].includes(phase)){writeFileSync(join(directory,filename),recordText,{mode:0o600});credit+=Buffer.byteLength(recordText);}
    if(phase==="partial-state"||phase==="state-temp"){const bytes=Buffer.from(stateText),copy=phase==="partial-state"?bytes.subarray(0,Math.floor(bytes.length/2)):bytes;writeFileSync(statePath+".tmp",copy,{mode:0o600});credit+=copy.length;}
    const reserved=descriptor.pending.remainingPeak-credit;
    const filler=join(root,"metadata.json.tmp"),fd=openSync(filler,"wx",0o600);try{ftruncateSync(fd,100*1024*1024-logicalBytes(root)-reserved);}finally{closeSync(fd);}
    expect(logicalBytes(root)+reserved).toBe(100*1024*1024);
    const samples:number[]=[];const sample=()=>samples.push(logicalBytes(root));
    await expect(openOutbox({port:server.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined},performance.now()+5000,{createFile(path,value){createFile(path,value);sample();},renameSync(from,to){renameSync(from,to);sample();},unlinkSync(path){if(path===filler)throw new Error("fixture stops before unrelated abandoned-temp cleanup");unlinkSync(path);sample();},syncDirectory(path){syncDirectory(path);sample();}})).rejects.toThrow("invalid_file");
    expect(samples).toEqual([]);
    expect(JSON.parse(readFileSync(statePath,"utf8")).allocatedThrough).toBe(1);
  }finally{await server.stop();}
});

it.each(["descriptor","record-temp","record"])("an already-open follower reconciles an actual SIGKILL after %s at the run quota before admission",async phase=> {
  const {spawn}=await import("node:child_process");
  const server=await launch(),f=await registeredRun(server),root=f.env.AGENTFLOW_OUTBOX_DIR;
  try {
    const sequence=seedRunToBytes(root,f.runId,RUN_BYTES-60000);
    const follower=await openOutbox({port:server.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined},performance.now()+5000);
    const samples:{global:number;run:number}[]=[],identities:{eventId:string;sequence:number}[]=[];
    const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-quota-crash.ts",phase,"report","--run",f.runId,"--type","run.progress","--payload",f.file({message:"\0".repeat(4000)})],{env:{...process.env,...f.env},stdio:["ignore","ignore","ignore","ipc"]});
    child.on("message",(message:unknown)=>{const item=message as {kind:string;global:number;run:number;eventId:string;sequence:number};if(item.kind==="sample")samples.push(item);if(item.kind==="identity")identities.push(item);});
    expect(await new Promise(resolve=>child.on("exit",(_code,signal)=>resolve(signal)))).toBe("SIGKILL");
    try {await expect(follower.enqueue(f.runId,"run.progress",{message:"\0".repeat(4000)})).rejects.toThrow("outbox_full");}finally{follower.close();}
    const state=JSON.parse(readFileSync(join(root,f.runId,"state.json"),"utf8"));
    expect(state.allocatedThrough).toBe(sequence+1);expect(state.pending).toBeUndefined();
    expect(identities).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(root,f.runId,`${sequence+1}-${identities[0].eventId}.json`),"utf8")).body.eventId).toBe(identities[0].eventId);
    expect(samples.length).toBeGreaterThan(0);expect(samples.every(sample=>sample.run<=RUN_BYTES && sample.global<=100*1024*1024)).toBe(true);
  }finally{await server.stop();}
});

it("an already-open follower reconciles an actual owner SIGKILL before another run admits work near the global quota",async()=> {
  const {spawn}=await import("node:child_process");
  const {createFile,syncDirectory}=await import("../../src/server/filesystem");
  const {renameSync,unlinkSync,lstatSync,readdirSync}=await import("node:fs");
  const server=await launch(),f=await registeredRun(server),root=f.env.AGENTFLOW_OUTBOX_DIR;
  try {
    const config={port:server.port,token:server.credentials().reporterToken,outbox:root,explicitService:undefined};
    const ids=[f.runId];
    const initializer=await openOutbox(config,performance.now()+5000);
    try {for(let i=0;i<10;i++){const id=randomUUID();const response=await fetch(server.url+"/api/v1/runs",{method:"POST",headers:{Authorization:`Bearer ${config.token}`,"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify({id,projectId:f.projectId,agentId:f.agentId,purpose:"planning"})});expect(response.status).toBe(201);expect((await initializer.initializeRun(id)).kind).toBe("delivered");ids.push(id);}}finally{initializer.close();}
    const rootBytes=readdirSync(root).reduce((sum,name)=>sum+(lstatSync(join(root,name)).isFile()?lstatSync(join(root,name)).size:0),0);
    const first=9*1024*1024;const sequence=seedRunToBytes(root,ids[0],first);seedRunToBytes(root,ids[1],first);
    let remaining=100*1024*1024-60000-rootBytes-2*first;
    for(let i=2;i<ids.length;i++){const size=Math.floor(remaining/(ids.length-i));seedRunToBytes(root,ids[i],size);remaining-=size;}
    expect(logicalBytes(root)).toBe(100*1024*1024-60000);
    const samples:{global:number;run:number}[]=[],identities:{eventId:string}[]=[];
    const sample=()=>samples.push({global:logicalBytes(root),run:logicalBytes(join(root,ids[0]))});
    const follower=await openOutbox(config,performance.now()+5000,{createFile(path,value){createFile(path,value);sample();},renameSync(from,to){renameSync(from,to);sample();},unlinkSync(path){unlinkSync(path);sample();},syncDirectory});
    const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-quota-crash.ts","descriptor","report","--run",ids[0],"--type","run.progress","--payload",f.file({message:"\0".repeat(4000)})],{env:{...process.env,...f.env},stdio:["ignore","ignore","ignore","ipc"]});
    child.on("message",(message:unknown)=>{const item=message as {kind:string;global:number;run:number;eventId:string};if(item.kind==="sample")samples.push(item);if(item.kind==="identity")identities.push(item);});
    expect(await new Promise(resolve=>child.on("exit",(_code,signal)=>resolve(signal)))).toBe("SIGKILL");
    try {await expect(follower.enqueue(ids[1],"run.progress",{message:"\0".repeat(4000)})).rejects.toThrow("outbox_full");}finally{follower.close();}
    const state=JSON.parse(readFileSync(join(root,ids[0],"state.json"),"utf8"));
    expect(state.allocatedThrough).toBe(sequence+1);expect(state.pending).toBeUndefined();expect(identities).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(root,ids[0],`${sequence+1}-${identities[0].eventId}.json`),"utf8")).body.eventId).toBe(identities[0].eventId);
    expect(samples.length).toBeGreaterThan(0);expect(samples.every(sample=>sample.global<=100*1024*1024 && sample.run<=RUN_BYTES)).toBe(true);
  }finally{await server.stop();}
});

it("serializes racing independent CLI admissions at the global ceiling without dropping either producer's retained prefix",async()=> {
  const {spawn}=await import("node:child_process");const {readdirSync}=await import("node:fs");const {globalQuotaFixture}=await import("../fixtures/p06-quota");
  const server=await launch(),f=await globalQuotaFixture(server);await server.stop();
  const samples:{global:number;run:number}[]=[];
  const results=await Promise.all(f.ids.slice(0,2).map(async id=> {
    const child=spawn(process.execPath,["--import","tsx","tests/fixtures/p06-quota-crash.ts","none","report","--run",id,"--type","run.progress","--payload",f.file({message:"\0".repeat(4000)})],{env:{...process.env,...f.env},stdio:["ignore","pipe","pipe","ipc"]});
    let stdout="",stderr="";child.stdout!.on("data",chunk=>stdout+=chunk);child.stderr!.on("data",chunk=>stderr+=chunk);child.on("message",(message:unknown)=>{const item=message as {kind:string;global:number;run:number};if(item.kind==="sample")samples.push(item);});
    const code=await new Promise(resolve=>child.on("exit",resolve));return{id,code,stdout,stderr};
  }));
  expect(results.map(result=>result.code).sort(),JSON.stringify({results,samples:samples.slice(-5),states:f.ids.slice(0,2).map(id=>JSON.parse(readFileSync(join(f.root,id,"state.json"),"utf8")))})).toEqual([1,2]);
  expect(results.every(result=>result.stdout==="")).toBe(true);
  expect(samples.length).toBeGreaterThan(0);expect(samples.every(sample=>sample.global<=100*1024*1024&&sample.run<=RUN_BYTES)).toBe(true);
  const allocations=results.map((result,index)=> {
    const state=JSON.parse(readFileSync(join(f.root,result.id,"state.json"),"utf8"));
    expect(state.acknowledgedThrough).toBe(0);expect(state.pending).toBeUndefined();
    expect(readdirSync(join(f.root,result.id)).filter(name=>/^\d+-/.test(name)).length).toBe(state.allocatedThrough);
    return state.allocatedThrough-f.sequences[index];
  });
  expect(allocations.sort()).toEqual([0,1]);expect(logicalBytes(f.root)).toBeLessThanOrEqual(100*1024*1024);
});

it.each(["descriptor","partial-record","record-temp","record","partial-state","state-temp"])("recovers valid immutable records with nonempty mutation samples at the exact global ceiling after %s",async phase=> {
  const {globalQuotaFixture,GLOBAL_BYTES}=await import("../fixtures/p06-quota");
  const {createFile,syncDirectory}=await import("../../src/server/filesystem");
  const {writeFileSync,renameSync,unlinkSync,readdirSync}=await import("node:fs");
  const server=await launch();
  let record: {formatVersion:number;body:Record<string,unknown>;digest:string},clean:Record<string,unknown>,filename="",reserved=0;
  try {
    const f=await globalQuotaFixture(server,(root,ids,sequences)=> {
      const directory=join(root,ids[0]),statePath=join(directory,"state.json"),old=JSON.parse(readFileSync(statePath,"utf8"));
      const body={schemaVersion:1,eventId:randomUUID(),runId:ids[0],sequence:sequences[0]+1,type:"run.progress",occurredAt:"2026-10-10T00:00:00.000Z",payload:{message:"exact retained original"}};
      record={formatVersion:1,body,digest:canonicalDigest(body)};clean={...old,allocatedThrough:body.sequence};filename=`${body.sequence}-${body.eventId}.json`;
      const recordText=JSON.stringify(record),stateText=JSON.stringify(clean),peak=Buffer.byteLength(recordText)+Buffer.byteLength(stateText);
      writeFileSync(statePath,JSON.stringify({...clean,pending:{record,filename,remainingPeak:peak}}));
      let credit=0;
      if(phase==="partial-record"||phase==="record-temp") {const bytes=Buffer.from(recordText),copy=phase==="partial-record"?bytes.subarray(0,Math.floor(bytes.length/2)):bytes;writeFileSync(join(directory,filename+".tmp"),copy,{mode:0o600});credit+=copy.length;}
      if(["record","partial-state","state-temp"].includes(phase)){writeFileSync(join(directory,filename),recordText,{mode:0o600});credit+=Buffer.byteLength(recordText);}
      if(phase==="partial-state"||phase==="state-temp"){const bytes=Buffer.from(stateText),copy=phase==="partial-state"?bytes.subarray(0,Math.floor(bytes.length/2)):bytes;writeFileSync(statePath+".tmp",copy,{mode:0o600});credit+=copy.length;}
      reserved=peak-credit;return reserved;
    });
    expect(logicalBytes(f.root)+reserved).toBe(GLOBAL_BYTES);
    const directory=join(f.root,f.runId),samples:{global:number;run:number}[]=[];
    const sample=(path:string)=>{if(path===directory||path.startsWith(directory+"/"))samples.push({global:logicalBytes(f.root),run:logicalBytes(directory)});};
    const outbox=await openOutbox(f.config,performance.now()+5000,{createFile(path,value){createFile(path,value);sample(path);},renameSync(from,to){renameSync(from,to);sample(String(to));},unlinkSync(path){unlinkSync(path);sample(String(path));},syncDirectory(path){syncDirectory(path);sample(path);}});
    outbox.close();
    expect(samples.length).toBeGreaterThan(0);expect(samples.every(s=>s.global<=GLOBAL_BYTES&&s.run<=RUN_BYTES)).toBe(true);
    expect(JSON.parse(readFileSync(join(directory,"state.json"),"utf8"))).toEqual(clean!);
    expect(JSON.parse(readFileSync(join(directory,filename),"utf8"))).toEqual(record!);
    expect(readdirSync(directory).filter(name=>/^\d+-/.test(name))).toHaveLength(f.sequences[0]+1);
    expect(readdirSync(directory).some(name=>name.endsWith(".tmp"))).toBe(false);
  }finally{await server.stop();}
});
