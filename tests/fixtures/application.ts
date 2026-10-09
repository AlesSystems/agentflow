import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { InstanceOwner } from '../../src/server/instance';
export function seedRun(owner:InstanceOwner,input:{projectId:string;taskId?:string;purpose?:'planning'|'implementation'|'review'|'verification';state?:'queued'|'running'|'succeeded'|'failed'|'cancelled'|'interrupted';workRevision?:number;createdAt?:number;receivedAt?:number;endedAt?:number;agentId?:string}){
 owner.assertOwned();const unregister=owner.registerConnection();const db=new Database(join(owner.dataDir,'agentflow.sqlite'));
 try{
 db.pragma('foreign_keys=ON');const agentId=input.agentId??randomUUID();const id=randomUUID();
 db.transaction(()=>{
 db.prepare("INSERT OR IGNORE INTO agents VALUES(?, 'Synthetic fixture agent','test','implementation',1,?)").run(agentId,input.createdAt??0);
 db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.projectId,agentId,input.taskId??null,input.purpose??(input.taskId?'implementation':'planning'),null,input.taskId?input.workRevision??1:null,input.state??'queued',0,input.receivedAt??0,null,input.endedAt??null,1,input.createdAt??0);
 })();return {id,agentId};
 }finally{db.close();unregister();}
}
export function persistedCounts(owner:InstanceOwner){
 const unregister=owner.registerConnection();const db=new Database(join(owner.dataDir,'agentflow.sqlite'),{readonly:true});
 try{return Object.fromEntries(['projects','tasks','comments','completions','reopens','receipts','changes','runs'].map(table=>[table,(db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {count:number}).count]));}finally{db.close();unregister();}
}
