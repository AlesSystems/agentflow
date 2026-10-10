import {it,expect,vi} from "vitest";
import {mkdtempSync,readFileSync,existsSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
const state=vi.hoisted(()=>({disconnected:0}));
vi.mock("node:inspector",()=>({Session:class{connect(){}disconnect(){state.disconnected++;}post(method:string,callback:(error:Error|null,result:unknown)=>void){callback(method==="Profiler.stop"?new Error("CPU stop fixture failure"):null,{});}}}));
import {profile} from "../fixtures/p07-diagnostic-profile";
it("retains available per-process anchors GC and loop data when CPU stop fails",async()=>{
 const path=join(mkdtempSync(join(tmpdir(),"p07-profile-fallback-")),"cpu.json");const finish=await profile(path,()=>({synthetic:true}));await new Promise(resolve=>setTimeout(resolve,120));
 await expect(finish()).rejects.toThrow("CPU stop fixture failure");const facts=JSON.parse(readFileSync(path+".partial.json","utf8"));expect(facts.status).toBe("CPU_UNFINALIZED");expect(facts.cpu).toBeNull();expect(facts.anchor.monotonicMs).toBeTypeOf("number");expect(facts.end.monotonicMs).toBeGreaterThan(facts.anchor.monotonicMs);expect(Array.isArray(facts.gc)).toBe(true);expect(facts.loop.length).toBeGreaterThan(0);expect(existsSync(path)).toBe(false);expect(state.disconnected).toBe(1);
});
