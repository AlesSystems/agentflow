import {afterEach,expect,it,vi} from "vitest";
import {scheduleGroups} from "../fixtures/p07-scheduler";
import {cadence} from "../fixtures/p07-protocol";
afterEach(()=>vi.useRealTimers());
it.each([false,true])("unchanged global ACK barrier propagates slow first-group ACKs (allslow=%s)",async allSlow=>{
 vi.useFakeTimers();vi.setSystemTime(0);
 const events=Array.from({length:30},(_,i)=>({producer:i%10,sequence:Math.floor(i/10)+1,dueMs:Math.floor(i/10)*100}));
 const records:{producer:number;sequence:number;dueMs:number;dispatchMs:number;responseMs:number|null}[]=[];
 const clock={now:()=>Date.now(),untilDue:async(time:number)=>{while(Date.now()<time)await new Promise(resolve=>setTimeout(resolve,time-Date.now()));}};
 const work=scheduleGroups(events,10,0,event=>event.dueMs,async(event,dispatchMs)=>{
  const record={...event,dispatchMs,responseMs:null as number|null};records.push(record);
  await new Promise(resolve=>setTimeout(resolve,event.sequence===1&&(allSlow||event.producer===0)?500:5));record.responseMs=Date.now();
 },clock);
 const settled=work.then(()=>null,error=>error);
 await vi.advanceTimersByTimeAsync(600);expect(await settled).toBeNull();
 expect(records.filter(row=>row.sequence===2).map(row=>row.dispatchMs)).toEqual(Array(10).fill(500));
 expect(records.filter(row=>row.sequence===3).map(row=>row.dispatchMs)).toEqual(Array(10).fill(505));
 expect(records.filter(row=>row.sequence===1&&row.producer>0).map(row=>row.responseMs)).toEqual(Array(9).fill(allSlow?500:5));
 for(let producer=0;producer<10;producer++)expect(records.filter(row=>row.producer===producer).map(row=>row.sequence)).toEqual([1,2,3]);
 expect(()=>cadence(600,100,0,600,records)).toThrow("MISSED_SLOT");
});
