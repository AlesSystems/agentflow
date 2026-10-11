import {proofErrors,type ProofErrorFacts} from "./p07-proof-errors";
export type FlushBoundaryReceipt={measuredStartedMs:number|null;measuredEndedMs:number|null;elapsedMs:number|null;failure:string;reconciliationStatus:string;reconciliation:unknown;failureFacts?:ProofErrorFacts;cleanup?:{startedMs:number;endedMs:number|null;failures:{action:string;error:string}[]}};
export async function flushBoundary(result:FlushBoundaryReceipt,work:()=>Promise<void>,cleanup:[string,()=>Promise<void>][],save:()=>void){
  const errors=proofErrors(error=>{result.failure=error instanceof Error?error.message:"non-Error thrown value";result.reconciliationStatus="unfinalized";result.reconciliation=null;});result.failureFacts=errors.facts;
  try{await work();}catch(error){errors.capture("work",error);}
  if(result.measuredStartedMs!==null&&result.measuredEndedMs===null){result.measuredEndedMs=performance.now();result.elapsedMs=result.measuredEndedMs-result.measuredStartedMs;}
  errors.save(save,"before flush cleanup");result.cleanup={startedMs:performance.now(),endedMs:null,failures:[]};
  for(const [name,action]of cleanup){await errors.attempt(name,async()=>{try{await action();}catch(error){result.cleanup!.failures.push({action:name,error:error instanceof Error?error.message:"non-Error thrown value"});throw error;}});}
  result.cleanup.endedMs=performance.now();errors.save(save,"after flush cleanup");errors.throwFirst();
}
