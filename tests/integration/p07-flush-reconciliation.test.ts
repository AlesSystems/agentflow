import {expect,it} from "vitest";
import {readFileSync,readdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {launch} from "../fixtures/server";
import {seedPerformance} from "../fixtures/p06-performance";
import {cliFixture} from "../fixtures/p06-cli";
import {publicProxy} from "../fixtures/p06-proxy";
import {openOutbox} from "../../src/cli/outbox";
import {collectFlush,validateFlush,type FlushFacts,type Attempt} from "../fixtures/p07-flush";
it("real queue flush joins bytes ACK API persistence and rejects connected leftover plus changed proof facts",async()=>{
  const dir=process.env.TMPDIR+"/p07-flush-control-"+Date.now();const counts={tasks:12,events:20,producers:2,queued:4};const fixture=await seedPerformance(dir,counts);const server=await launch({dir});
  const attempts:Attempt[]=[];const proxy=await publicProxy(server,(req,body,reply)=>{if(reply&&req.url?.endsWith("/events"))attempts.push({requestBytesBase64:body.toString("base64"),responseBytesBase64:reply.body.toString("base64"),status:reply.status,generation:reply.generation});return undefined;});
  const f=cliFixture({...server,port:proxy.port});const box=await openOutbox({port:proxy.port,token:server.credentials().reporterToken,outbox:f.env.AGENTFLOW_OUTBOX_DIR,explicitService:undefined},performance.now()+10000);
  const facts:FlushFacts={expected:{...counts,runs:fixture.runs},queued:[],attempts,stdout:[],generation:null,database:null,pages:[],files:[]};const rejected:string[]=[];const negative:{name:string;facts:FlushFacts}[]=[];
  try{
    expect(box.acquireDelivery()).toBe(true);
    for(const type of ["run.started","run.heartbeat"])for(const runId of fixture.runs)expect((await f.cli(["report","--run",runId,"--type",type,"--payload",f.file({})])).code).toBe(2);
    for(const runId of fixture.runs)for(const name of readdirSync(join(f.env.AGENTFLOW_OUTBOX_DIR,runId)).filter(name=>/^\d+-/.test(name))){const bytes=readFileSync(join(f.env.AGENTFLOW_OUTBOX_DIR,runId,name)),record=JSON.parse(bytes.toString());facts.queued.push({...record,bytes:bytes.length,fileSha256:createHash("sha256").update(bytes).digest("hex"),filename:`${runId}/${name}`,originalBytesBase64:bytes.toString("base64")});}
    box.close();const flush=await f.cli(["flush"]);expect(flush.code).toBe(0);facts.stdout.push(flush.stdout);
    const replay=await fetch(`http://127.0.0.1:${proxy.port}/api/v1/runs/${fixture.runs[0]}/events`,{method:"POST",headers:{Authorization:"Bearer "+server.credentials().reporterToken,"Content-Type":"application/json"},body:JSON.stringify(facts.queued[0].body)});expect(replay.status).toBe(200);await replay.text();
    await collectFlush(facts,dir,f.env.AGENTFLOW_OUTBOX_DIR,server);expect(validateFlush(facts)).toMatchObject({status:"finalized",uniqueEvents:4,httpAttempts:5,created201:4,replayed200:1,allocated:4,acked:4,pending:0,apiCount:4});
    function bad(name:string,mutate:(copy:FlushFacts)=>void){const copy=structuredClone(facts);mutate(copy);negative.push({name,facts:copy});expect(()=>validateFlush(copy),name).toThrow();rejected.push(name);}
    bad("wrong HTTP receipt",copy=>{const raw=JSON.parse(Buffer.from(copy.attempts[0].responseBytesBase64!,"base64").toString());raw.data.receivedAt="2026-01-01T00:00:00.000Z";copy.attempts[0].responseBytesBase64=Buffer.from(JSON.stringify(raw)).toString("base64");});
    bad("malformed raw HTTP ACK",copy=>copy.attempts[0].responseBytesBase64=Buffer.from("{").toString("base64"));
    bad("stdout sequence",copy=>{const lines=copy.stdout[0].trim().split("\n"),ack=JSON.parse(lines[0]);ack.acceptedSequence++;lines[0]=JSON.stringify(ack);copy.stdout[0]=lines.join("\n");});
    bad("same ID API body",copy=>{const raw=JSON.parse(copy.pages[0].raw);raw.data.items[0].occurredAt="2026-01-01T00:00:00.000Z";copy.pages[0].raw=JSON.stringify(raw);});
    bad("same ID API receipt",copy=>{const raw=JSON.parse(copy.pages[0].raw);raw.data.items[0].receivedAt="2026-01-01T00:00:00.000Z";copy.pages[0].raw=JSON.stringify(raw);});
    bad("watermark",copy=>{const state=copy.files.find(file=>file.path.endsWith("/state.json"))!,raw=JSON.parse(Buffer.from(state.bytesBase64,"base64").toString());raw.acknowledgedThrough=1;state.bytesBase64=Buffer.from(JSON.stringify(raw)).toString("base64");});
    bad("entity count",copy=>copy.database!.counts.tasks--);bad("integrity",copy=>copy.database!.integrity=[{integrity_check:"failed"}]);bad("FK",copy=>copy.database!.foreignKeys=[{table:"tasks"}]);bad("original bytes",copy=>copy.queued[0].originalBytesBase64=Buffer.from("{}").toString("base64"));
    const faultPath=join(f.env.AGENTFLOW_OUTBOX_DIR,fixture.runs[0],"state.json.tmp");writeFileSync(faultPath,"{}",{mode:0o600});const connected={...facts,pages:[],files:[]};await collectFlush(connected,dir,f.env.AGENTFLOW_OUTBOX_DIR,server);expect(()=>validateFlush(connected)).toThrow("PENDING_ARTIFACTS");expect(readFileSync(faultPath,"utf8")).toBe("{}");rejected.push("actual retained filesystem temp, read-only collector");
    if(process.env.AGENTFLOW_P07_EVIDENCE_DIR)writeFileSync(join(process.env.AGENTFLOW_P07_EVIDENCE_DIR,"flush-connected-controls.json"),JSON.stringify({facts,connected,negative,rejected,flush,dir,outbox:f.env.AGENTFLOW_OUTBOX_DIR},null,2),{mode:0o600});
  }finally{box.close();await proxy.close();await server.stop();}
},30000);
