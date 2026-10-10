import {failureFact} from "./p07-warm-error";
export type ProofErrorFacts={failed:boolean;persistence:string|null;errors:{action:string;error:ReturnType<typeof failureFact>}[]};
export function proofErrors(onFailure:(error:unknown)=>void){
 let present=false,primary:unknown;const facts:ProofErrorFacts={failed:false,persistence:null,errors:[]};
 function capture(action:string,error:unknown){if(!present){present=true;primary=error;}facts.failed=true;facts.errors.push({action,error:failureFact(error)});onFailure(primary);}
 function save(write:()=>void,action:string,critical=false){const prior=present;try{write();}catch(error){facts.persistence="missing or earlier snapshot; latest write failed";capture(action,error);if(critical&&!prior)throw primary;}}
 async function attempt(action:string,work:()=>Promise<void>){try{await work();}catch(error){capture(action,error);}}
 return {facts,capture,save,attempt,failed:()=>present,throwFirst:()=>{if(present)throw primary;}};
}
