import {proofErrors,type ProofErrorFacts} from "./p07-proof-errors";
export type ResourceInterval={status?:string;startedMs?:number|null;endedMs:number|null;failure?:string|null;failureFacts?:ProofErrorFacts;cleanup?:{startedMs:number;endedMs:number|null;failures:{action:string;error:string}[]}};
export async function resourceBoundary(result:ResourceInterval,measure:()=>Promise<void>,cleanup:[string,()=>Promise<void>][],save:()=>void){
  const errors=proofErrors(error=>{result.failure=error instanceof Error?error.message:"non-Error thrown value";result.status="unfinalized";});result.failureFacts=errors.facts;
  try{await measure();result.status="finalized";}catch(error){errors.capture("measure",error);}
  if(result.startedMs!==null)result.endedMs??=performance.now();errors.save(save,"before resource cleanup");
  result.cleanup={startedMs:performance.now(),endedMs:null,failures:[]};
  for(const [name,action]of cleanup){await errors.attempt(name,async()=>{try{await action();}catch(error){result.cleanup!.failures.push({action:name,error:error instanceof Error?error.message:"non-Error thrown value"});throw error;}});}
  result.cleanup.endedMs=performance.now();errors.save(save,"after resource cleanup");errors.throwFirst();
}
