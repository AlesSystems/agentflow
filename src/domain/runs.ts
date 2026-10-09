import type { EventInput, Run, RunRegistration } from '../contracts/observations';
import type { Task } from '../contracts/tasks';
import { Conflict } from './tasks';
export function observationFreshness(run:Run,now:number) {
 const active=run.state==='queued'||run.state==='running';
 const stale=active && now-Date.parse(run.lastReceivedAt)>60000;
 return {stale,reporting:!active?'terminal' as const:stale?'stale' as const:run.lastSequence===0?'no_report_received' as const:'fresh' as const};
}
export function decideRegistration(input:RunRegistration,task:Task|null,active:boolean,now:number) {
 if (!task) return null;
 if(task.projectId!==input.projectId) throw new Conflict('task_project_mismatch');
 if(task.version!==input.expectedTaskVersion) throw new Conflict('version_conflict',task.version);
 if(task.status==='completed') throw new Conflict('task_completed');
 if(active) throw new Conflict('active_run');
 return {...task,version:task.version+1,workRevision:task.workRevision+(input.purpose==='implementation'?1:0),updatedAt:new Date(now).toISOString()};
}
export function decideEvent(run:Run,event:EventInput,task:Task|null,now:number) {
 if(event.sequence!==run.lastSequence+1) throw new Conflict(event.sequence>run.lastSequence+1?'sequence_gap':'sequence_conflict',undefined,{expectedSequence:run.lastSequence+1});
 if(!['queued','running'].includes(run.state)) throw new Conflict('run_terminal');
 if(run.state==='queued' && !['run.started','run.cancelled'].includes(event.type) || run.state==='running' && event.type==='run.started') throw new Conflict('run_transition_invalid');
 const time=new Date(now).toISOString();
 const outcomes={'run.started':'running','run.succeeded':'succeeded','run.failed':'failed','run.cancelled':'cancelled'} as const;
 const state=event.type in outcomes ? outcomes[event.type as keyof typeof outcomes]:run.state;
 const next={...run,state,lastSequence:event.sequence,lastReceivedAt:time,version:run.version+1,startedAt:event.type==='run.started'?time:run.startedAt,endedAt:['succeeded','failed','cancelled'].includes(state)?time:run.endedAt};
 let nextTask=null;
 if(run.purpose==='implementation' && (event.type==='run.started'||event.type==='run.succeeded')) {
  if(!task || task.workRevision!==run.workRevision) throw new Conflict('implementation_not_current');
  if(task.status==='completed') throw new Conflict('task_completed');
  nextTask={...task,status:event.type==='run.started'?'in_progress' as const:'review' as const,version:task.version+1,updatedAt:time};
 }
 return {run:next,task:nextTask};
}
export function decideClose(run:Run,expectedVersion:number,now:number):Run {
 if(run.version!==expectedVersion) throw new Conflict('version_conflict',run.version);
 if(!['queued','running'].includes(run.state)) throw new Conflict('run_terminal');
 if(!observationFreshness(run,now).stale) throw new Conflict('run_not_stale');
 return {...run,state:'interrupted',endedAt:new Date(now).toISOString(),version:run.version+1};
}
