export type ResourceInterval={status?:string;endedMs:number|null;failure?:string|null;cleanup?:{startedMs:number;endedMs:number|null;failures:{action:string;error:string}[]}};
export async function resourceBoundary(result:ResourceInterval,measure:()=>Promise<void>,cleanup:[string,()=>Promise<void>][],save:()=>void){
  let failure:unknown;
  try{await measure();result.status="finalized";}catch(error){failure=error;result.failure=error instanceof Error?error.message:"measurement failed";}
  result.endedMs=performance.now();save();
  result.cleanup={startedMs:performance.now(),endedMs:null,failures:[]};
  for(const [name,action]of cleanup){try{await action();}catch(error){result.cleanup.failures.push({action:name,error:error instanceof Error?error.message:"cleanup failed"});}}
  result.cleanup.endedMs=performance.now();save();
  if(failure)throw failure;if(result.cleanup.failures.length)throw new Error("RESOURCE_CLEANUP_FAILED");
}
