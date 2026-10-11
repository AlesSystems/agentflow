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
