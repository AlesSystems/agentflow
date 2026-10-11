import { proofErrors } from "./p07-proof-errors";
import { failureFact } from "./p07-warm-error";
import type { ordinaryBoundary } from "./p07-ordinary";
import assert from "node:assert/strict";
import { openSync,writeSync,fsyncSync,closeSync,lstatSync } from "node:fs";
import { join } from "node:path";
export type FactSave=(fact:unknown,phase:string,kind?:string)=>void;
export function captureJournal(root:string,header:unknown,io:{write:(fd:number,bytes:Buffer,offset:number,length:number)=>number;sync:(fd:number)=>void}={write:writeSync,sync:fsyncSync}){
 assert.equal(lstatSync(root).mode&0o777,0o700,"private journal root required");
 const path=join(root,"capture.jsonl"),fd=openSync(path,"ax",0o600);let ordinal=0,failure:unknown,closed=false;
 function append(kind:string,id:string,phase:string,snapshot:unknown){assert(!closed,"journal closed");if(failure)throw failure;try{const bytes=Buffer.from(JSON.stringify({formatVersion:1,ordinal:ordinal+1,kind,id,phase,controllerMs:performance.now(),snapshot})+"\n");let offset=0;while(offset<bytes.length){const written=io.write(fd,bytes,offset,bytes.length-offset);assert(written>0,"journal short write");offset+=written;}io.sync(fd);ordinal++;}catch(error){failure=error;throw error;}}
 try{append("header","campaign","frozen",header);}catch(error){closeSync(fd);throw error;}
 const save:FactSave=(fact,phase,kind="fact")=>{assert(fact&&typeof fact==="object"&&"id" in fact&&typeof fact.id==="string","explicit journal fact identity required");append(kind,fact.id,phase,fact);};
 return {path,save,checkpoint(fact:unknown,write:()=>void){let primary:unknown;try{save(fact,"checkpoint","campaign");}catch(error){primary=error;}try{write();}catch(error){if(primary instanceof Error)Object.assign(primary,{aggregatePersistenceFailure:String(error)});else primary??=error;}if(primary!==undefined)throw primary;},close(){if(!closed){closed=true;closeSync(fd);}},ordinal:()=>ordinal};
}

export async function journalBoundary(result:Parameters<typeof ordinaryBoundary>[0]&{acceptance:boolean},work:Parameters<typeof ordinaryBoundary>[1],journal:ReturnType<typeof captureJournal>,snapshot:()=>unknown,write:()=>void,summary:()=>void,exitFailure:()=>void){
 const errors=proofErrors(error=>{result.acceptance=false;const message=failureFact(error).message;if(!result.failures.includes(message))result.failures.push(message);});result.failureFacts=errors.facts;
 function checkpoint(critical=true){const prior=errors.failed();
  try{journal.save(snapshot(),"checkpoint","campaign");}catch(error){errors.facts.persistence="Journal missing or incomplete; campaign invalid";errors.capture("journal checkpoint",error);}
  try{write();}catch(error){errors.facts.persistence=(errors.facts.persistence?errors.facts.persistence+"; ":"")+"aggregate missing or earlier snapshot";errors.capture("aggregate checkpoint",error);}
  if(critical&&!prior&&errors.failed())errors.throwFirst();
 }
 try{checkpoint();await work(checkpoint);}catch(error){errors.capture("W02 work",error);}
 finally{result.finishedAt=new Date().toISOString();result.cleanup="Owned teardown attempted; partial errors retained and synthetic roots preserved";checkpoint(false);if(errors.failed())exitFailure();try{summary();}catch(error){errors.capture("W02 summary",error);}if(errors.failed())exitFailure();errors.throwFirst();}
}
