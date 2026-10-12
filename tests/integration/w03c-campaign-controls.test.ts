import { expect,it } from "vitest";
import { mkdirSync,mkdtempSync,readFileSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash,randomUUID } from "node:crypto";
import { openOwnedStore } from "../../src/db";
import { auditStoppedSql,campaignDeclarations,reconcileCampaign,type CampaignSample } from "../fixtures/w03c-campaign";
import { qualifiedService } from "../fixtures/w03a-qualification";
import { boundedFetch,readBoundedText } from "../fixtures/w01-runtime";
it("audits a stopped copied SQLite triplet preserving protected original bytes",async()=>{const dir=mkdtempSync(join(tmpdir(),"w03c-audit-control-")),proof=join(dir,"proof");mkdirSync(proof,{mode:0o700});const owned=await openOwnedStore(dir);owned.close();const before=createHash("sha256").update(readFileSync(join(dir,"agentflow.sqlite"))).digest("hex");const facts=auditStoppedSql(dir,proof);expect(facts.integrity).toBe("ok");expect(facts.foreignKeys).toEqual([]);expect(facts.copy).not.toBe(dir);expect(facts.before).toEqual(facts.after);expect(facts.before).toEqual(facts.copied);expect(createHash("sha256").update(readFileSync(join(dir,"agentflow.sqlite"))).digest("hex")).toBe(before);expect(facts.rows).toHaveProperty("instance_metadata");});
it("rejects real failed HTTP with every intended campaign request still declared",async()=>{const services:unknown[]=[],declarations=campaignDeclarations();let observation:CampaignSample|undefined;await qualifiedService({},services,async(server,cookie)=>{const at=performance.now(),response=await boundedFetch(server.url+"/api/v1/usage?projectId="+randomUUID(),{headers:{Cookie:cookie}}),text=await readBoundedText(response),done=performance.now();expect(response.status).toBe(400);observation={...declarations[0],fingerprint:"a".repeat(64),fixture:"base-1",generation:response.headers.get("AgentFlow-Generation")??"",cursor:"0",status:response.status,dispatchMs:at,drainedMs:done,elapsedMs:done-at,failure:null,expectedFacts:{status:200},facts:JSON.parse(text)};});const binding={fingerprint:"a".repeat(64),fixture:"base-1",generation:observation!.generation,cursor:"0"};const result=reconcileCampaign(declarations,[observation!],{base:binding,head:binding});expect(result).toMatchObject({acceptance:false,expected:3810,attempted:1});expect(result.invalid).toContain(declarations[0].id);expect(result.missing).toHaveLength(3809);const proof=process.env.AGENTFLOW_W03C_CONTROL_PROOF_DIR;if(proof)writeFileSync(join(proof,"actual-failed-http.json"),JSON.stringify({services,observation,result},null,2),{mode:0o600,flag:"wx"});});

import { usageCliFixture,reportedUsage } from "../fixtures/w03c-cli";
import { witnessAcceptance,type CorrectnessWitness } from "../fixtures/w03c-campaign";
it("rejects missing native CLI ACK, absent UI reset, and killed-service shutdown evidence",async()=>{
 const fixture=await usageCliFixture("campaign-native-controls");let facts;
 try{expect((await fixture.command(["report","--run",fixture.runId,"--type","run.started","--payload",fixture.file({})])).code).toBe(0);expect((await fixture.command(["report","--run",fixture.runId,"--type","run.usage","--payload",fixture.file(reportedUsage("native-control"))])).code).toBe(0);facts=await fixture.finish();}finally{await fixture.stop();}
 const usageEvents=facts.events.filter(row=>row.type==="run.usage");expect(usageEvents).toHaveLength(1);
 const services:unknown[]=[];await expect(qualifiedService({},services,async server=>{server.child.kill("SIGKILL");})).rejects.toThrow("qualified graceful shutdown");
 const killed=services[0] as {closed:boolean;exitCode:number|null;signalCode:string|null};
 const value:CorrectnessWitness={cli:{exitCode:0,pending:fixture.pending().length,declared:usageEvents.map(row=>({eventId:row.event_id,sequence:row.sequence})),acks:usageEvents.map(row=>JSON.parse(row.acknowledgement).data)},ui:{priorGeneration:"11111111-1111-4111-8111-111111111111",generation:"22222222-2222-4222-8222-222222222222",tabs:[]},shutdown:{...killed,stdioClosed:true,runtime:null,history:null,streams:null}};
 const actual=witnessAcceptance(value);expect(actual).toMatchObject({acceptance:false,cliValid:true,uiValid:false,shutdownValid:false,expectedAcks:1,expectedTabs:2});
 const missing=witnessAcceptance({...value,cli:{...value.cli,acks:[]}});expect(missing).toMatchObject({acceptance:false,cliValid:false,expectedAcks:1,observedAcks:0});
 const proof=process.env.AGENTFLOW_W03C_CONTROL_PROOF_DIR;if(proof)writeFileSync(join(proof,"native-witness-controls.json"),JSON.stringify({facts,services,value,actual,missing},null,2),{mode:0o600,flag:"wx"});
});

it("captures actual idle launcher shutdown counters with no operation timing samples",async()=>{
 const services:unknown[]=[];let dir="";const proof=process.env.AGENTFLOW_W03C_CONTROL_PROOF_DIR??mkdtempSync(join(tmpdir(),"w03c-idle-proof-"));
 await qualifiedService({cwd:process.cwd(),entry:"tests/fixtures/w03c-measure-server.ts"},services,async server=>{dir=server.dir;}).finally(()=>writeFileSync(join(proof,"idle-native-service-original.json"),JSON.stringify({services,dir},null,2),{mode:0o600,flag:"wx"}));
 const service=services[0] as {closed:boolean;exitCode:number|null;signalCode:string|null;stdout:string};
 expect(service).toMatchObject({closed:true,exitCode:0,signalCode:null});
 const records=service.stdout.split("\n").filter(line=>line.startsWith("{")).map(line=>JSON.parse(line));
 expect(records.filter(row=>String(row.kind).endsWith("Timing"))).toEqual([]);
 writeFileSync(join(proof,"idle-native-observations.json"),JSON.stringify(records,null,2),{mode:0o600,flag:"wx"});
 const shutdown=records.find(row=>row.kind==="shutdown");expect(shutdown.runtime).toEqual({requests:0,sockets:0,activeSockets:0});expect(shutdown.history.leases).toBe(0);
 for(const key of ["leases","bytes","blocked","timers","listeners"])expect(shutdown.streams[key]).toBe(0);
 expect(shutdown.backupLeases).toBe(0);expect(shutdown.readers).toBe(0);expect(shutdown.descriptors).not.toContain(join(dir,"agentflow.sqlite"));
 const copies=join(proof,"idle-sql-copies");mkdirSync(copies,{mode:0o700});const facts=auditStoppedSql(dir,copies);
 writeFileSync(join(proof,"idle-native-resources.json"),JSON.stringify({qualification:"Production launcher/native HTTP service plus test wrapper instrumentation, idle work. Does not prove browser React tracking resources. No operation timing rows.",services,records,dir,facts},null,2),{mode:0o600,flag:"wx"});
});
