export type FlushBoundaryReceipt={measuredStartedMs:number|null;measuredEndedMs:number|null;elapsedMs:number|null;failure:string;reconciliationStatus:string;reconciliation:unknown;cleanup?:{startedMs:number;endedMs:number|null;failures:{action:string;error:string}[]}};
export async function flushBoundary(result:FlushBoundaryReceipt,work:()=>Promise<void>,cleanup:[string,()=>Promise<void>][],save:()=>void){
  let primary:unknown;
  try{await work();}catch(error){primary=error;result.failure=error instanceof Error?error.message:"unknown failure";result.reconciliationStatus="unfinalized";result.reconciliation=null;}
  if(result.measuredStartedMs!==null&&result.measuredEndedMs===null){result.measuredEndedMs=performance.now();result.elapsedMs=result.measuredEndedMs-result.measuredStartedMs;}
  save();result.cleanup={startedMs:performance.now(),endedMs:null,failures:[]};
  for(const [name,action]of cleanup){try{await action();}catch(error){result.cleanup.failures.push({action:name,error:error instanceof Error?error.message:"unknown cleanup failure"});}}
  result.cleanup.endedMs=performance.now();save();
  if(primary)throw primary;if(result.cleanup.failures.length)throw new Error("FLUSH_CLEANUP_FAILED");
}
