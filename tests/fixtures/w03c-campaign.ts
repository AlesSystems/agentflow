import { distribution } from "./p07-protocol";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { createHash,randomUUID } from "node:crypto";
import { chmodSync,copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
export type Declaration={id:string;source:"base"|"head";operation:string;cohort:"legacy"|"unique"|"duplicate"|"query"|"price";repetition:number;ordinal:number;warmup:boolean};
export type Binding={fingerprint:string;fixture:string;generation:string;cursor:string};
export type CampaignSample=Declaration&Binding&{status:number|null;dispatchMs:number|null;drainedMs:number|null;elapsedMs:number|null;failure:string|null;expectedFacts:unknown;facts:unknown};
export function campaignDeclarations():Declaration[]{
 const rows:Declaration[]=[];
 for(let repetition=1;repetition<=3;repetition++){
  for(const source of ["base","head"] as const){for(const operation of ["tasks","events","activity","progress.ingest","export"]){const measured=operation==="export"?10:100;for(let ordinal=0;ordinal<10+measured;ordinal++)rows.push({id:`${operation}-${source}-${repetition}-${ordinal}`,source,operation,cohort:"legacy",repetition,ordinal,warmup:ordinal<10});}}
  for(const [operation,cohort,measured] of [["usage.query","query",100],["usage.ingest","unique",100],["usage.ingest","duplicate",100],["price.create","price",10]] as const)for(let ordinal=0;ordinal<10+measured;ordinal++)rows.push({id:`${operation}-${cohort}-head-${repetition}-${ordinal}`,source:"head",operation,cohort,repetition,ordinal,warmup:ordinal<10});
 }
 return rows;
}
export function reconcileCampaign(declared:Declaration[],samples:CampaignSample[],bindings:Record<"base"|"head",Binding>){
 const wanted=new Map(declared.map(row=>[row.id,row])),counts=new Map<string,number>(),invalid:string[]=[];
 for(const row of samples){
  counts.set(row.id,(counts.get(row.id)??0)+1);const expected=wanted.get(row.id),binding=bindings[row.source];
  const declaration=expected&&Object.keys(expected).every(key=>isDeepStrictEqual(row[key as keyof Declaration],expected[key as keyof Declaration]));
  const identity=binding&&Object.keys(binding).every(key=>row[key as keyof Binding]===binding[key as keyof Binding]);
  const timing=row.dispatchMs!==null&&row.drainedMs!==null&&row.elapsedMs!==null&&Number.isFinite(row.elapsedMs)&&row.elapsedMs>=0&&row.drainedMs>=row.dispatchMs&&Math.abs(row.elapsedMs-(row.drainedMs-row.dispatchMs))<0.000001;
  if(!declaration||!identity||!timing||![200,201].includes(row.status??0)||row.failure!==null||!isDeepStrictEqual(row.facts,row.expectedFacts))invalid.push(row.id);
 }
 const missing=declared.filter(row=>!counts.has(row.id)).map(row=>row.id),duplicate=[...counts].filter(([,n])=>n!==1).map(([id])=>id);
 return {acceptance:wanted.size===declared.length&&!missing.length&&!duplicate.length&&!invalid.length,expected:declared.length,attempted:samples.length,declaredIds:declared.map(row=>row.id),attemptedIds:samples.map(row=>row.id),missing,invalid,duplicate};
}
export function auditStoppedSql(dir:string,proof:string){
 const hashes=(path:string)=>Object.fromEntries(["","-wal","-shm","-journal"].filter(s=>existsSync(join(path,"agentflow.sqlite"+s))).map(s=>[s,createHash("sha256").update(readFileSync(join(path,"agentflow.sqlite"+s))).digest("hex")]));
 const identities=Object.fromEntries(["","-wal","-shm","-journal"].filter(s=>existsSync(join(dir,"agentflow.sqlite"+s))).map(s=>{const stat=lstatSync(join(dir,"agentflow.sqlite"+s));return [s,{dev:stat.dev,ino:stat.ino,uid:stat.uid,mode:stat.mode&0o777,size:stat.size}];}));
 assert.equal(lstatSync(proof).mode&0o777,0o700);const before=hashes(dir),copy=join(proof,randomUUID());mkdirSync(copy,{mode:0o700});
 for(const suffix of Object.keys(before)){copyFileSync(join(dir,"agentflow.sqlite"+suffix),join(copy,"agentflow.sqlite"+suffix));chmodSync(join(copy,"agentflow.sqlite"+suffix),0o600);}
 const copied=hashes(copy);assert.deepEqual(copied,before);const db=new Database(join(copy,"agentflow.sqlite"),{readonly:true,fileMustExist:true});
 let integrity:unknown,foreignKeys:unknown,rows:Record<string,unknown[]>;
 try{integrity=db.pragma("integrity_check",{simple:true});foreignKeys=db.pragma("foreign_key_check");const tables=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name NOT LIKE 'sqlite_%' OR name='sqlite_sequence') ORDER BY name").all() as {name:string}[]).map(row=>row.name);rows=Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM "${t.replaceAll('"','""')}" ORDER BY rowid`).all()]));}
 finally{db.close();assert.deepEqual(hashes(dir),before,"protected original SQLite changed during copied audit");}
 return {before,after:hashes(dir),copied,copy,integrity,foreignKeys,rows,identities};
}
export type CorrectnessWitness={cli:{exitCode:number|null;pending:number;declared:{eventId:string;sequence:number}[];acks:{eventId:string;acceptedSequence:number}[]};ui:{priorGeneration:string;generation:string;tabs:{generation:string;resetObserved:boolean}[]};shutdown:{closed:boolean;stdioClosed:boolean;exitCode:number|null;signalCode:string|null;runtime:{requests:number;sockets:number;activeSockets:number}|null;history:{leases:number}|null;streams:{leases:number;bytes:number;blocked:number;timers:number;listeners:number}|null}};
export function witnessAcceptance(value:CorrectnessWitness){
 const {cli,ui,shutdown}=value;
 const cliValid=cli.declared.length>0&&cli.exitCode===0&&cli.pending===0&&new Set(cli.declared.map(row=>row.eventId)).size===cli.declared.length&&cli.acks.length===cli.declared.length&&new Set(cli.acks.map(row=>row.eventId)).size===cli.acks.length&&cli.declared.every(row=>cli.acks.some(ack=>ack.eventId===row.eventId&&ack.acceptedSequence===row.sequence));
 const uiValid=ui.generation!==ui.priorGeneration&&ui.tabs.length===2&&ui.tabs.every(tab=>tab.generation===ui.generation&&tab.resetObserved);
 const shutdownValid=shutdown.closed&&shutdown.stdioClosed&&shutdown.exitCode===0&&shutdown.signalCode===null&&shutdown.runtime?.requests===0&&shutdown.runtime?.sockets===0&&shutdown.runtime?.activeSockets===0&&shutdown.history?.leases===0&&shutdown.streams?.leases===0&&shutdown.streams?.bytes===0&&shutdown.streams?.blocked===0&&shutdown.streams?.timers===0&&shutdown.streams?.listeners===0;
 return {acceptance:cliValid&&uiValid&&shutdownValid,expectedAcks:cli.declared.length,observedAcks:cli.acks.length,expectedTabs:2,observedTabs:ui.tabs.length,cliValid,uiValid,shutdownValid};
}
export function campaignSummary(declared:Declaration[],samples:CampaignSample[]){
 const key=(r:Declaration)=>`${r.operation}-${r.source}-${r.cohort}-${r.repetition}`,keys=[...new Set(declared.map(key))];
 const groups=keys.map(id=>{const wanted=declared.filter(r=>key(r)===id&&!r.warmup),observed=samples.filter(r=>key(r)===id&&!r.warmup),valid=observed.length===wanted.length&&new Set(observed.map(r=>r.id)).size===wanted.length&&observed.every(r=>wanted.some(w=>w.id===r.id)&&r.elapsedMs!==null&&Number.isFinite(r.elapsedMs)&&r.elapsedMs>=0);return {id,operation:wanted[0].operation,source:wanted[0].source,cohort:wanted[0].cohort,repetition:wanted[0].repetition,expected:wanted.length,attempted:observed.length,distribution:valid?distribution(observed.map(r=>r.elapsedMs!)):null};});
 const budgetFailures=groups.filter(g=>["tasks","events","activity","usage.query","usage.ingest"].includes(g.operation)&&(!g.distribution||g.distribution.p95Ms>=250)).map(g=>g.id);
 const regressions=groups.filter(g=>{if(g.source!=="head"||g.cohort!=="legacy")return false;const base=groups.find(b=>b.source==="base"&&b.operation===g.operation&&b.repetition===g.repetition);return !!g.distribution&&!!base?.distribution&&g.distribution.p95Ms>base.distribution.p95Ms*1.2;}).map(g=>g.id);
 return {acceptance:groups.every(g=>g.distribution!==null)&&!budgetFailures.length&&!regressions.length,groups,budgetFailures,regressions,qualification:"HTTP completion only; native SQL/export scheduler timings are separate; each regression requires Root exact-source explanation and Astra approval"};
}
export function bindNativeTimings(records:Record<string,unknown>[],requests:{id:string;operation:string;key:string|null}[]):Record<string,unknown>[]{
 const queries=requests.filter(r=>["tasks","events","activity","usage.query"].includes(r.operation)),commands=requests.filter(r=>r.key!==null),exports=requests.filter(r=>r.operation==="export"),timings=records.filter(r=>String(r.kind).endsWith("Timing"));
 assert.equal(timings.filter(r=>r.kind==="queryTiming").length,queries.length);assert.equal(timings.filter(r=>r.kind==="commandTiming").length,commands.length);assert.equal(timings.filter(r=>r.kind==="exportPreparationTiming").length,exports.length);assert.equal(timings.filter(r=>r.kind==="backupTiming").length,exports.length);
 const preparations=timings.filter(r=>r.kind==="exportPreparationTiming");
 for(let ordinal=1;ordinal<=exports.length;ordinal++){assert.equal(preparations.filter(r=>r.ordinal===ordinal).length,1);const batches=timings.filter(r=>r.kind==="exportBatchTiming"&&r.ordinal===ordinal);assert(batches.length);assert.deepEqual(batches.map(r=>r.batch),batches.map((_,i)=>i+1));assert.equal(batches.at(-1)!.rows,0);assert(batches.every((r,i)=>Number.isInteger(r.rows)&&Number(r.rows)>=0&&Number(r.rows)<=100&&(i===batches.length-1||Number(r.rows)>0)));}
 const operation:Record<string,string>={tasks:"tracking.tasks",events:"events",activity:"activity","usage.query":"usage"};
 return timings.map(row=>{assert(typeof row.ms==="number"&&Number.isFinite(row.ms)&&row.ms>=0);let request;
  if(row.kind==="queryTiming"){assert(Number.isInteger(row.ordinal));request=queries[Number(row.ordinal)-1];assert(request&&operation[request.operation]===row.operation);assert.equal(timings.filter(r=>r.kind==="queryTiming"&&r.ordinal===row.ordinal).length,1);}
  else if(row.kind==="commandTiming"){request=commands.find(r=>r.key===row.key);assert.equal(timings.filter(r=>r.kind==="commandTiming"&&r.key===row.key).length,1);}
  else if(row.kind==="exportPreparationTiming"||row.kind==="exportBatchTiming")request=exports[Number(row.ordinal)-1];
  else if(row.kind==="backupTiming"){const preparation=preparations.find(r=>r.destination===row.destination);request=preparation&&exports[Number(preparation.ordinal)-1];assert.equal(timings.filter(r=>r.kind==="backupTiming"&&r.destination===row.destination).length,1);}
  assert(request,"native timing has no original request identity");return {...row,requestId:request.id};
 });
}
