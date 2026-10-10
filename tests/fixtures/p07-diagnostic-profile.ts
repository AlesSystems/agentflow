import {Session} from "node:inspector";
import {monitorEventLoopDelay,PerformanceObserver} from "node:perf_hooks";
import {writeFileSync} from "node:fs";
export async function profile(path:string,extra:()=>unknown=()=>null){
 const session=new Session();session.connect();
 const post=(method:string)=>new Promise<{profile?:unknown}>((resolve,reject)=>session.post(method,(error,result)=>error?reject(error):resolve(result??{})));
 const gc:unknown[]=[],loop:unknown[]=[];const delay=monitorEventLoopDelay({resolution:10});
 const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())gc.push({startMs:entry.startTime,durationMs:entry.duration,detail:(entry as unknown as {detail:unknown}).detail});});
 observer.observe({entryTypes:["gc"]});delay.enable();
 await post("Profiler.enable");await post("Profiler.start");
 const anchor={monotonicMs:performance.now(),wallMs:Date.now(),memory:process.memoryUsage(),pid:process.pid};
 const timer=setInterval(()=>{loop.push({ms:performance.now(),maxMs:delay.max/1e6,p99Ms:delay.percentile(99)/1e6,extra:extra()});delay.reset();},100);
 return async()=>{clearInterval(timer);delay.disable();observer.disconnect();const cpu=await post("Profiler.stop");session.disconnect();const result={anchor,end:{monotonicMs:performance.now(),wallMs:Date.now(),memory:process.memoryUsage()},gc,loop,cpu:cpu.profile};writeFileSync(path,JSON.stringify(result)+"\n",{mode:0o600});return {anchor:result.anchor,end:result.end,gcCount:gc.length,loopSamples:loop.length};};
}
