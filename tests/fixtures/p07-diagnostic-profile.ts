import {failureFact} from "./p07-warm-error";
import {Session} from "node:inspector";
import {monitorEventLoopDelay,PerformanceObserver} from "node:perf_hooks";
import {writeFileSync} from "node:fs";
export async function profile(path:string,extra:()=>unknown=()=>null){
 const session=new Session();session.connect();
 const post=(method:string)=>new Promise<{profile?:unknown}>((resolve,reject)=>session.post(method,(error,result)=>error?reject(error):resolve(result??{})));
 const gc:unknown[]=[],loop:unknown[]=[];const delay=monitorEventLoopDelay({resolution:10});
 const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())gc.push({startMs:entry.startTime,durationMs:entry.duration,detail:(entry as unknown as {detail:unknown}).detail});});
 observer.observe({entryTypes:["gc"]});delay.enable();
 try{await post("Profiler.enable");await post("Profiler.start");}catch(error){delay.disable();observer.disconnect();session.disconnect();throw error;}
 const anchor={monotonicMs:performance.now(),wallMs:Date.now(),memory:process.memoryUsage(),pid:process.pid};
 const timer=setInterval(()=>{loop.push({ms:performance.now(),maxMs:delay.max/1e6,p99Ms:delay.percentile(99)/1e6,extra:extra()});delay.reset();},100);
 return async()=>{
  let failed=false,primary:unknown;
  const result={anchor,end:null as unknown,gc,loop,cpu:null as unknown,status:"CPU_UNFINALIZED",errors:[] as {action:string;error:ReturnType<typeof failureFact>}[]};
  const capture=(action:string,error:unknown)=>{if(!failed){failed=true;primary=error;}result.status="FAILED";result.errors.push({action,error:failureFact(error)});};
  try{
   for(const [action,work]of [["stop interval",()=>clearInterval(timer)],["disable delay",()=>delay.disable()],["disconnect observer",()=>observer.disconnect()]] as [string,()=>unknown][]){try{work();}catch(error){capture(action,error);}}
   result.end={monotonicMs:performance.now(),wallMs:Date.now(),memory:process.memoryUsage()};
   try{writeFileSync(path+".partial.json",JSON.stringify(result)+"\n",{mode:0o600});}catch(error){capture("partial write",error);}
   try{const cpu=await post("Profiler.stop");result.cpu=cpu.profile;if(!failed)result.status="CPU_FINALIZED";}catch(error){capture("CPU stop",error);}
   if(result.cpu!==null)try{writeFileSync(path,JSON.stringify(result)+"\n",{mode:0o600});}catch(error){capture("full write",error);}
  }finally{try{session.disconnect();}catch(error){capture("disconnect inspector",error);}}
  if(failed){try{if(primary!==null&&(typeof primary==="object"||typeof primary==="function"))Object.defineProperty(primary,"profileFacts",{value:result,configurable:true});}catch{}throw primary;}
  return {anchor:result.anchor,end:result.end,gcCount:gc.length,loopSamples:loop.length};
 };
}
