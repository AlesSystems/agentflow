import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { fileSHA256, ownedDirectory } from "./w04-qualification";
export const requiredResources = {
 service: ["requests", "activeSockets", "leases", "timers", "exportCopies", "locks", "children"],
 browser: ["eventSources", "timeouts", "intervals", "pages", "contexts", "processes"],
} as const;
export function privateSave(root:string,name:string,value:unknown){
 ownedDirectory(root,true);assert(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name));
 writeFileSync(join(root,name),JSON.stringify(value,null,2)+"\n",{mode:0o600,flag:"wx"});
}
export function databasePins(dir:string){
 const result:Record<string,{path:string;dev:number;ino:number;uid:number;gid:number;nlink:number;mode:number;size:number;sha256:string}>={};
 for(const suffix of ["","-wal","-shm","-journal"]){const path=join(dir,"agentflow.sqlite"+suffix);if(existsSync(path)){const s=lstatSync(path);assert(s.isFile()&&!s.isSymbolicLink());result[suffix]={path,dev:s.dev,ino:s.ino,uid:s.uid,gid:s.gid,nlink:s.nlink,mode:s.mode&0o777,size:s.size,sha256:fileSHA256(path)};}}
 assert(Object.hasOwn(result,""),"complete present database required");return result;
}
export function stoppedAudit(dir:string,destination:string,stopped:boolean){
 assert.equal(stopped,true,"inspection requires stopped owner");const before=databasePins(dir);mkdirSync(destination,{mode:0o700});ownedDirectory(destination,true);
 for(const suffix of Object.keys(before)){const file=join(destination,"agentflow.sqlite"+suffix);copyFileSync(before[suffix].path,file);}
 const copiedBefore=databasePins(destination);for(const suffix of Object.keys(before)){assert.notEqual(before[suffix].ino,copiedBefore[suffix].ino);assert.equal(before[suffix].sha256,copiedBefore[suffix].sha256);}
 const db=new Database(join(destination,"agentflow.sqlite"),{readonly:true});let rows:Record<string,Record<string,unknown>[]>,schema:unknown,integrity:unknown,foreignKeys:unknown;
 try{const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all() as {name:string}[];
 rows=Object.fromEntries(tables.map(({name})=>[name,db.prepare(`SELECT rowid,* FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all() as Record<string,unknown>[]]));
 schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all();integrity=db.pragma("integrity_check",{simple:true});foreignKeys=db.pragma("foreign_key_check");
 }finally{db.close();}
 const after=databasePins(dir);assert.deepEqual(after,before,"original changed during stopped copy audit");assert.equal(integrity,"ok");assert.deepEqual(foreignKeys,[]);
 return {dir,destination,before,copiedBefore,copiedAfter:databasePins(destination),after,rows,schema,integrity,foreignKeys,queries:["SELECT rowid,* FROM each table ORDER BY rowid","SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name","PRAGMA integrity_check","PRAGMA foreign_key_check"],copySidecarNote:"Readonly copy may create or change WAL/SHM; original present-member bytes and identities are unchanged."};
}
export function validateClosedResources(value:unknown){
 assert(value!==null&&typeof value==="object"&&!Array.isArray(value));
 const owners=value as Record<string,Record<string,unknown>>;
 for(const [owner,keys] of Object.entries(requiredResources)){assert(Object.hasOwn(owners,owner));assert(owners[owner]&&typeof owners[owner]==="object"&&!Array.isArray(owners[owner]));for(const key of keys){assert(Object.hasOwn(owners[owner],key),`missing ${owner}.${key}`);assert.equal(owners[owner][key],0,`open ${owner}.${key}`);}}
}
// These probes count observable web owners only; they do not account for internal React or Chromium allocations.
export function browserProbes(){
 const sources=new Set<EventSource>(),timeouts=new Set<number>(),intervals=new Set<number>();
 const NativeSource=window.EventSource,timeout=window.setTimeout.bind(window),interval=window.setInterval.bind(window),clearTimeoutNative=window.clearTimeout.bind(window),clearIntervalNative=window.clearInterval.bind(window);
 class TrackedSource extends NativeSource{constructor(url:string|URL,options?:EventSourceInit){super(url,options);sources.add(this);}close(){sources.delete(this);super.close();}}
 window.EventSource=TrackedSource;
 window.setTimeout=((handler:TimerHandler,ms?:number,...args:unknown[])=>{const id=timeout(()=>{timeouts.delete(id);if(typeof handler==="function")handler(...args);else window.eval(handler);},ms);timeouts.add(id);return id;}) as typeof window.setTimeout;
 window.clearTimeout=((id?:number)=>{if(id!==undefined)timeouts.delete(id);clearTimeoutNative(id);}) as typeof window.clearTimeout;
 window.setInterval=((handler:TimerHandler,ms?:number,...args:unknown[])=>{const id=interval(handler,ms,...args);intervals.add(id);return id;}) as typeof window.setInterval;
 window.clearInterval=((id?:number)=>{if(id!==undefined)intervals.delete(id);clearIntervalNative(id);}) as typeof window.clearInterval;
 Object.assign(window,{w04ResourceSnapshot:()=>({eventSources:sources.size,timeouts:timeouts.size,intervals:intervals.size,scope:"Patched public EventSource and timer registrations in this document; excludes internal React/browser resources"})});
}
export function artifactInventory(root:string){const result:Record<string,unknown>={};const visit=(dir:string)=>{for(const name of readdirSync(dir).sort()){const path=join(dir,name),s=lstatSync(path);if(s.isDirectory())visit(path);else if(s.isFile())result[path]={sha256:fileSHA256(path),dev:s.dev,ino:s.ino,mode:s.mode&0o777,size:s.size};else assert(!s.isSymbolicLink(),"artifact links must be separately declared");}};visit(root);return result;}
export const originalJSON=(path:string)=>JSON.parse(readFileSync(path,"utf8"));

if(process.argv[1]===import.meta.filename){
 const {startRuntime}=await import("../../src/server/launcher"),{readConfig}=await import("../../src/server/config"),{createInterface}=await import("node:readline");
 assert(global.gc,"controlled GC capability required");
 const running=await startRuntime(readConfig(process.env,"production"));
 const snapshot=()=>{let locks=1;try{running.owned.instance.assertOwned();}catch{locks=0;}return {runtime:running.diagnostics(),streams:running.streams.diagnostics(),history:running.history.diagnostics(),exports:readdirSync(join(running.owned.store.dataDir,"exports")),locks,memory:process.memoryUsage()};};
 createInterface({input:process.stdin}).on("line",async line=>{const input=JSON.parse(line);assert(Number.isInteger(input.id));for(let i=0;i<3;i++){global.gc!();await new Promise(resolve=>setTimeout(resolve,25));}console.log("W04_MEASURE "+JSON.stringify({id:input.id,...snapshot(),collection:"three explicit runtime GC calls each followed by 25ms"}));});
 process.once("SIGTERM",()=>void(async()=>{
  const initial=snapshot();await running.shutdown();const end=Date.now()+3000;
  while(running.diagnostics().sockets&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,25));
  const final=snapshot();console.log("W04_SHUTDOWN "+JSON.stringify({initial,final,scope:"Native service request/socket/SSE/history lease counters, actual export-directory children and instance ownership; child exit is observed separately by controller"}));process.exit(0);
 })().catch(error=>{console.error(error);process.exit(1);}));
}

export async function controlResources(root:string,cwd:string,nodeExecutable:string){
 const {qualifiedService}=await import("./w03a-qualification"),{chromium,expect}=await import("@playwright/test"),{pairPage}=await import("./p03");
 const dir=join(root,"resource-control");mkdirSync(dir,{mode:0o700});const services:unknown[]=[],browserFacts:unknown[]=[];
 let finalBrowser:Record<string,number>|undefined;let primary:unknown;
 try{await qualifiedService({cwd,dir,nodeExecutable,entry:"tests/fixtures/w04-resources.ts",nodeArgs:["--expose-gc"],stdin:true},services,async server=>{
  const browserServer=await chromium.launchServer({channel:"chrome",headless:true}),child=browserServer.process(),browser=await chromium.connect(browserServer.wsEndpoint());
  const closed=new Promise<{code:number|null;signal:string|null}>(resolve=>child.once("close",(code,signal)=>resolve({code,signal})));const contexts=[];
  try{for(let index=0;index<2;index++){const context=await browser.newContext();contexts.push(context);await context.addInitScript({content:"const __name=(value)=>value;("+browserProbes.toString()+")();"});const page=await context.newPage();page.on("pageerror",error=>browserFacts.push({tab:index,pageError:String(error)}));await pairPage(page,server);await expect(page.getByText("Connected updates",{exact:true})).toBeVisible();browserFacts.push({tab:index,url:page.url(),initial:await page.evaluate(()=>Reflect.get(window,"w04ResourceSnapshot")()),compiledScripts:await page.locator("script[src]").evaluateAll(nodes=>nodes.map(n=>(n as HTMLScriptElement).src))});}}
  finally{for(const context of contexts){const pages=context.pages();await context.close();assert(pages.every(p=>p.isClosed()));browserFacts.push({contextsClosed:true,pagesClosed:pages.length});}await browser.close();await browserServer.close();const closure=await closed;assert.equal(closure.code,0);assert.equal(closure.signal,null);assert.equal(browser.isConnected(),false);try{process.kill(child.pid!,0);assert.fail("owned Chrome still alive");}catch(error){assert.equal((error as NodeJS.ErrnoException).code,"ESRCH");}browserFacts.push({pid:child.pid,closure,processAbsent:true,scope:"All observed document/probe owners belong to two explicitly closed contexts in this terminated owned Chrome process. No global or internal React accounting claimed."});finalBrowser={eventSources:0,timeouts:0,intervals:0,pages:0,contexts:0,processes:0};}
 });}catch(error){primary=error;}
 privateSave(root,"resource-control-originals.json",{services,browserFacts,failure:primary===undefined?null:String(primary)});if(primary!==undefined)throw primary;
 const record=services[0] as {stdout:string;pid:number;closed:boolean;exitCode:number;signalCode:null};const line=record.stdout.split("\n").find(s=>s.startsWith("W04_SHUTDOWN "));assert(line,"original native shutdown required");const native=JSON.parse(line.slice(13));const f=native.final;
 const resources={service:{requests:f.runtime.requests,activeSockets:f.runtime.activeSockets,leases:f.streams.leases,timers:f.streams.timers,exportCopies:f.exports.length,locks:f.locks,children:record.closed&&record.exitCode===0&&record.signalCode===null?0:1},browser:finalBrowser};validateClosedResources(resources);
 const result={resources,native,services,browserFacts,officialSamples:0,operationTimingRows:[],audit:stoppedAudit(dir,join(root,"resource-control-audit"),true)};privateSave(root,"resource-control.json",result);return result;
}

export function processTree(rootPid:number){
 const raw=execFileSync("/bin/ps",["-axo","pid=,ppid=,uid=,lstart=,command="],{encoding:"utf8"});
 const rows=raw.split("\n").flatMap(line=>{const m=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(line);return m?[{pid:Number(m[1]),ppid:Number(m[2]),uid:Number(m[3]),started:m[4],command:m[5]}]:[];});
 const wanted=new Set([rootPid]);let prior=-1;while(prior!==wanted.size){prior=wanted.size;for(const row of rows)if(wanted.has(row.ppid))wanted.add(row.pid);}return {rootPid,originalPS:raw,rows:rows.filter(r=>wanted.has(r.pid))};
}
export function verifyProcessClosure(before:ReturnType<typeof processTree>){
 const after=processTree(before.rootPid);for(const row of before.rows){const current=after.rows.find(r=>r.pid===row.pid&&r.started===row.started);assert(!current,"owned original process still alive "+row.pid);try{process.kill(row.pid,0);const raw=execFileSync("/bin/ps",["-p",String(row.pid),"-o","lstart="],{encoding:"utf8"}).trim();assert.notEqual(raw,row.started,"owned descendant still alive");}catch(error){assert.equal((error as NodeJS.ErrnoException).code,"ESRCH");}}return {before,after,allObservedOwnedPIDsAbsent:true};
}

export async function ownedBrowser(){
 const {chromium}=await import("@playwright/test"),server=await chromium.launchServer({channel:"chrome",headless:true}),child=server.process(),browser=await chromium.connect(server.wsEndpoint()),before=processTree(child.pid!);
 const original={pid:child.pid,spawnargs:child.spawnargs,processes:before};
 return {browser,original,async close(){const beforeClose=processTree(child.pid!);await browser.close();await server.close();return {original,beforeClose,closure:verifyProcessClosure(beforeClose),connected:browser.isConnected()};}};
}

import type {FiniteDeclaration} from "./w04-campaign";
export async function officialResources(root:string,dir:string,cwd:string,runtime:string,port:number,rows:FiniteDeclaration[],save:(row:unknown)=>void){
 const {qualifiedService}=await import("./w03a-qualification"),{pairPage}=await import("./p03"),{expect}=await import("@playwright/test");const services:unknown[]=[],measurements:unknown[]=[],browserFacts:unknown[]=[];let failure:unknown;
 try{await qualifiedService({cwd,dir,port,nodeExecutable:join(runtime,"bin/node"),entry:"tests/fixtures/w04-resources.ts",nodeArgs:["--expose-gc"],stdin:true},services,async(server,cookie)=>{
  const owner=await ownedBrowser(),contexts=[];try{for(let tab=0;tab<2;tab++){const context=await owner.browser.newContext();contexts.push(context);await context.addInitScript({content:"const __name=(value)=>value;("+browserProbes.toString()+")();"});const page=await context.newPage();await pairPage(page,server);await expect(page.getByText("Connected updates",{exact:true})).toBeVisible();browserFacts.push({tab,initial:await page.evaluate(()=>Reflect.get(window,"w04ResourceSnapshot")())});}
   const diagnose=async(id:number)=>{server.child.stdin!.write(JSON.stringify({id})+"\n");const until=Date.now()+10000;for(;;){const line=server.logs().split("\n").find(l=>l.startsWith("W04_MEASURE ")&&JSON.parse(l.slice(12)).id===id);if(line)return JSON.parse(line.slice(12));assert(Date.now()<until,"resource metrics deadline");await new Promise(resolve=>setTimeout(resolve,25));}};
   const before=await diagnose(1);measurements.push({before});for(const row of rows){const abort=new AbortController(),response=await fetch(server.url+row.endpoint,{headers:{Cookie:cookie},signal:abort.signal});assert.equal(response.status,200);const reader=response.body!.getReader(),first=await reader.read();abort.abort();await reader.cancel().catch(()=>{});save({kind:"sseCycle",id:row.id,status:response.status,firstBytesBase64:Buffer.from(first.value??[]).toString("base64"),aborted:true});}
   await new Promise(resolve=>setTimeout(resolve,500));const after=await diagnose(2);measurements.push({after});save({kind:"resourceControlledCollection",before,after});assert.equal(after.streams.leases,before.streams.leases,"stream baseline not restored");assert(after.memory.heapUsed<=before.memory.heapUsed*1.2,"heap >20% after same controlled collection");
  }finally{for(const context of contexts)await context.close();browserFacts.push({closure:await owner.close(),contextsClosed:contexts.length});}
 });}catch(error){failure=error;}finally{privateSave(root,"resource-originals.json",{services,measurements,browserFacts,failure:failure===undefined?null:String(failure)});}if(failure!==undefined)throw failure;
 const last=services.at(-1) as {stdout:string},line=last.stdout.split("\n").find(l=>l.startsWith("W04_SHUTDOWN "));assert(line);const original=JSON.parse(line.slice(13)),f=original.final,resources={service:{requests:f.runtime.requests,activeSockets:f.runtime.activeSockets,leases:f.streams.leases,timers:f.streams.timers,exportCopies:f.exports.length,locks:f.locks,children:0},browser:{eventSources:0,timeouts:0,intervals:0,pages:0,contexts:0,processes:0}};validateClosedResources(resources);return {services,measurements,browserFacts,resources,original};
}
