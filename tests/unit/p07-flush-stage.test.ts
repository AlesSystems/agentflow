import {it,expect,vi,beforeEach} from "vitest";
import {mkdtempSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const control=vi.hoisted(()=>({failure:"setup",stops:0,error:new Error("setup"),fixture:{runs:["run"],projectId:"project"}}));
vi.mock("../fixtures/p06-performance",()=>({seedPerformance:async()=>control.fixture}));
vi.mock("../fixtures/server",()=>({launch:async()=>{if(control.failure==="setup")throw control.error;return{credentials:()=>({reporterToken:"synthetic"}),stop:async()=>{control.stops++;}};},pair:async()=>""}));
vi.mock("../fixtures/p06-proxy",()=>({publicProxy:async()=>{throw control.error;}}));
import {flushRun} from "../fixtures/p07-flush-stage";
beforeEach(()=>{control.stops=0;});
it.each(["setup","HTTP"])("actual shared flush stage retains %s failure with unstarted timing and remaining cleanup",async failure=>{
 control.failure=failure;control.error=new Error(failure);const root=mkdtempSync(join(tmpdir(),"p07-stage-")),receipt={flush:[] as unknown[]},saved:string[]=[];
 await expect(flushRun(1,{root,counts:{tasks:1000,events:10000,producers:10,queued:1000},acceptance:true,receipt,writeReceipt:()=>saved.push(JSON.stringify(receipt))})).rejects.toBe(control.error);
 const result=receipt.flush[0] as {measuredStartedMs:null;measuredEndedMs:null;reconciliationStatus:string;failure:string;requests:unknown[]};
 expect(result.measuredStartedMs).toBeNull();expect(result.measuredEndedMs).toBeNull();expect(result.reconciliationStatus).toBe("unfinalized");expect(result.requests).toEqual([]);expect(saved.length).toBeGreaterThan(1);expect(control.stops).toBe(failure==="HTTP"?1:0);
 if(failure==="HTTP")expect(readFileSync(join(root,"inputs-1","reporter-token"),"utf8")).toBe("synthetic");
},10000);
it("actual shared stage preserves first IO failure and no measured phase begins",async()=>{
 control.failure="HTTP";const error=new Error("ENOSPC"),root=mkdtempSync(join(tmpdir(),"p07-stage-")),receipt={flush:[] as unknown[]};
 await expect(flushRun(1,{root,counts:{tasks:1000,events:10000,producers:10,queued:1000},acceptance:true,receipt,writeReceipt:()=>{throw error;}})).rejects.toBe(error);
 expect(control.stops).toBe(0);expect((receipt.flush[0] as {measuredEndedMs:null}).measuredEndedMs).toBeNull();
});
