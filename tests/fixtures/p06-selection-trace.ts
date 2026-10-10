import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { main } from "../../src/cli/main";
import { openOutbox } from "../../src/cli/outbox";
import { createFile,syncDirectory } from "../../src/server/filesystem";
const [trace,...args]=process.argv.slice(2);
const turns:{owners:number[];cursorOwner?:number;durable?:boolean;record?:unknown}[]=[];
let active=false,owner=0,serial=0;
const exec=Database.prototype.exec;
Database.prototype.exec=function(sql:string){const result=exec.call(this,sql);if(active&&this.name.endsWith("publication.sqlite")){if(sql==="BEGIN EXCLUSIVE"){owner=++serial;turns.at(-1)!.owners.push(owner);}if(sql==="ROLLBACK")owner=0;}return result;};
const save=()=>writeFileSync(trace,JSON.stringify({qualification:"private ownership reproduction only",turns})+"\n",{mode:0o600});
try{process.exitCode=await main(args,async(config,end)=> {
 const box=await openOutbox(config,end,{createFile(path,body){if(active&&path.endsWith("metadata.json.tmp")&&JSON.parse(String(body)).cursor!==null)turns.at(-1)!.cursorOwner=owner;createFile(path,body);},syncDirectory(path){syncDirectory(path);if(active&&path===config.outbox&&turns.at(-1)!.cursorOwner){turns.at(-1)!.durable=true;save();}}});
 const combined=(box as typeof box & {selectForTurn?: (id:string,cursor:string,until:number)=>ReturnType<typeof box.next>}).selectForTurn;
 return {...box,async next(id:string,until?:number){active=true;turns.push({owners:[]});const record=await box.next(id,until);turns.at(-1)!.record=record?.body;save();return record;},async advanceCursor(id:string,until?:number){await box.advanceCursor(id,until);active=false;save();},...(combined?{async selectForTurn(id:string,cursor:string,until:number){active=true;turns.push({owners:[]});try{const record=await combined(id,cursor,until);turns.at(-1)!.record=record?.body;return record;}finally{active=false;save();}}}:{})};
 });}finally{Database.prototype.exec=exec;save();}
