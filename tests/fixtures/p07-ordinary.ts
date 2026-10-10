import {proofErrors,type ProofErrorFacts} from "./p07-proof-errors";
import {failureFact} from "./p07-warm-error";
export async function ordinaryStages<T>(steps:{repetitions:number;load:(index:number)=>Promise<void>;resource:()=>Promise<void>;flush:(index:number)=>Promise<void>;prepareNative:()=>Promise<T>;compare:(index:number,input:T)=>Promise<void>}){
 for(let index=0;index<steps.repetitions;index++)await steps.load(index);await steps.resource();for(let index=1;index<=steps.repetitions;index++)await steps.flush(index);const input=await steps.prepareNative();for(let index=1;index<=steps.repetitions;index++)await steps.compare(index,input);
}
export async function ordinaryBoundary(result:{failures:string[];finishedAt?:string;cleanup?:string;failureFacts?:ProofErrorFacts},work:(save:()=>void)=>Promise<void>,write:()=>void,summary:()=>void,exitFailure:()=>void){
 const errors=proofErrors(error=>{const message=failureFact(error).message;if(!result.failures.includes(message))result.failures.push(message);});result.failureFacts=errors.facts;
 const save=()=>errors.save(write,"ordinary save",true);
 try{save();await work(save);}catch(error){errors.capture("ordinary work",error);}
 finally{
  result.finishedAt=new Date().toISOString();result.cleanup="Owned teardown attempted; partial errors retained and synthetic roots preserved";
  errors.save(write,"ordinary final save");if(errors.failed())exitFailure();try{summary();}catch(error){errors.capture("ordinary summary",error);}if(errors.failed())exitFailure();errors.throwFirst();
 }
}
