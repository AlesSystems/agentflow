export type FlushBoundaryReceipt={measuredStartedMs:number|null;measuredEndedMs:number|null;elapsedMs:number|null;failure:string;reconciliationStatus:string;reconciliation:unknown;cleanup?:{startedMs:number;endedMs:number|null;failures:{action:string;error:string}[]}};
export async function flushBoundary(result:FlushBoundaryReceipt,work:()=>Promise<void>,cleanup:[string,()=>Promise<void>][],save:()=>void){
  await work();for(const [,action]of cleanup)await action();save();
}
