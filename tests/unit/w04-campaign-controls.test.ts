import { expect, it } from "vitest";
import { validatePrepared, validateResult, type PreparedCampaign, type CampaignResult } from "../fixtures/w04-campaign";
const hash="a".repeat(64);
function prepared(): PreparedCampaign {
 return {version:1,scope:"task1-qualification",sources:{base:hash,head:hash},helperSHA256:hash,runtimeSHA256:hash,builds:{base:hash,head:hash},intendedIds:["head-tasks-1-0"],declarations:[{id:"head-tasks-1-0",source:"head",operation:"tasks",endpoint:"/api/v1/tasks",repetition:1,fixture:"head-1",warmup:false}],fixtures:[{id:"head-1",source:"head",sha256:hash,schema:12,generation:"11111111-1111-4111-8111-111111111111",cursor:"0"}],requiredResources:{service:["requests","sockets"],browser:["eventSources","timers"]},correctness:{cli:{originalSHA256:hash,exitCode:0,declared:["event-1"],acks:["event-1"]},tabs:[{id:"graph",originalSHA256:hash,generation:"11111111-1111-4111-8111-111111111111"},{id:"list",originalSHA256:hash,generation:"11111111-1111-4111-8111-111111111111"}]},officialWorkloadComplete:false};
}
function result():CampaignResult{return {samples:[{id:"head-tasks-1-0",accepted:true,failure:null}],resources:{service:{requests:0,sockets:0},browser:{eventSources:0,timers:0}},shutdown:{closed:true,stdioClosed:true,exitCode:0,signalCode:null}};}
it("accepts complete finite qualification facts without claiming official readiness",()=>{expect(validatePrepared(prepared())).toMatchObject({intended:1,officialReady:false});expect(validateResult(prepared(),result())).toEqual({intended:1,attempted:1,accepted:1,rejected:0,missing:[],failed:[],acceptance:true});});
for(const defect of ["missing ID","duplicate ID","missing CLI","missing two tabs","empty resources","failed shutdown","missing sample","duplicate sample"] as const)it(`rejects ${defect} with the intended count preserved`,()=>{
 const p=prepared(),r=result();
 if(defect==="missing ID")p.declarations[0].id="";
 else if(defect==="duplicate ID")p.declarations.push({...p.declarations[0]});
 else if(defect==="missing CLI")p.correctness.cli.acks=[];
 else if(defect==="missing two tabs")p.correctness.tabs.pop();
 else if(defect==="empty resources")r.resources.service={};
 else if(defect==="failed shutdown")r.shutdown.exitCode=1;
 else if(defect==="missing sample")r.samples=[];
 else r.samples.push({...r.samples[0]});
 if(["missing ID","duplicate ID","missing CLI","missing two tabs"].includes(defect))expect(()=>validatePrepared(p)).toThrow();
 else expect(validateResult(p,r)).toMatchObject({intended:1,acceptance:false});
});
it("rejects an omitted declaration against the separately frozen intended IDs",()=>{const p=prepared();p.intendedIds.push("head-tasks-1-1");p.declarations.push({...p.declarations[0],id:"head-tasks-1-1"});expect(validatePrepared(p)).toMatchObject({intended:2});p.declarations.pop();expect(()=>validatePrepared(p)).toThrow(/missing or wrong intended sample IDs/);});

it("rejects official readiness when no finite workload protocol or stopped-copy facts exist",()=>{
 const p=prepared();p.officialWorkloadComplete=true;
 expect(()=>validatePrepared(p)).toThrow(/official|protocol|stopped/i);
});
