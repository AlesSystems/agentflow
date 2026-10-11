export async function scheduleGroups<T>(events:T[],producers:number,start:number,due:(event:T)=>number,dispatch:(event:T,dispatchMs:number)=>Promise<void>,clock={now:()=>performance.now(),untilDue:async (time:number)=>{while(performance.now()<time)await new Promise(resolve=>setTimeout(resolve,Math.max(0,time-performance.now())));}}){
  for(let offset=0;offset<events.length;offset+=producers){
    const group=events.slice(offset,offset+producers);await clock.untilDue(start+due(group[0]));
    await Promise.all(group.map(event=>dispatch(event,clock.now())));
  }
}
