export async function scheduleGroups<T>(events:T[],producers:number,start:number,due:(event:T)=>number,dispatch:(event:T,dispatchMs:number)=>Promise<void>,clock={now:()=>performance.now(),untilDue:async (time:number)=>{while(performance.now()<time)await new Promise(resolve=>setTimeout(resolve,Math.max(0,time-performance.now())));}}){
  void events;void producers;void start;void due;void dispatch;void clock;
  throw new Error("SCHEDULER_SEAM_NOT_IMPLEMENTED");
}
