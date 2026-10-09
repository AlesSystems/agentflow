import { mkdtempSync,realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect,it } from 'vitest';
import { openOwnedStore } from '../../src/db';
import { canonicalDigest } from '../../src/contracts/common';
import type { ApplicationCommand } from '../../src/db/application';
it('bounds stable lists and retrieves every immutable acceptance and reopen exactly once',async()=>{
 const owned=await openOwnedStore(mkdtempSync(join(realpathSync(tmpdir()),'agentflow-pages-')));
 try{
 let now=1000;
 const send=(command:ApplicationCommand)=>owned.store.command(command,{principal:'operator',method:'POST',path:command.kind,key:randomUUID(),digest:canonicalDigest(command),now:now++});
 const projectId=(send({kind:'project.create',input:{name:'Synthetic'}}).body.data as {id:string}).id;
 for(let i=0;i<105;i++)send({kind:'task.create',input:{projectId,title:`task ${i}`}});
 const page=owned.store.snapshot({kind:'tasks',input:{projectId,limit:50}},now).body;
 const list=page.data as {items:{id:string}[];nextCursor:string;total:number};expect(list.items).toHaveLength(50);expect(list.total).toBe(105);expect(list.nextCursor).toBeTypeOf('string');
 const next=owned.store.snapshot({kind:'tasks',input:{projectId,limit:50,cursor:list.nextCursor}},now).body.data as typeof list;
 expect(next.items).toHaveLength(50);expect(new Set([...list.items,...next.items].map(t=>t.id)).size).toBe(100);
 expect(()=>owned.store.snapshot({kind:'tasks',input:{projectId,limit:49,cursor:list.nextCursor}},now)).toThrow('cursor_invalid');
 const id=list.items[0].id;let version=1;
 for(let i=0;i<55;i++){
 send({kind:'task.patch',id,input:{expectedVersion:version++,status:'review'}});
 send({kind:'task.complete',id,input:{expectedVersion:version++,evidenceNote:'Synthetic acceptance'}});
 send({kind:'task.reopen',id,input:{expectedVersion:version++,reason:'Synthetic rework'}});
 }
 for(const history of ['completion','reopen'] as const){
 let cursor:string|undefined;const ids:string[]=[];
 do{
 const data=owned.store.snapshot({kind:'task',id,input:{history,historyLimit:50,...(history==='completion'?{completionCursor:cursor}:{reopenCursor:cursor})}},now).body.data as {history:{completions:{items:{id:string}[];nextCursor:string|null;nextUrl:string|null}|null;reopens:{items:{id:string}[];nextCursor:string|null;nextUrl:string|null}|null}};
 const result=history==='completion'?data.history.completions!:data.history.reopens!;ids.push(...result.items.map(f=>f.id));
 expect(history==='completion'?data.history.reopens:data.history.completions).toBeNull();
 if(result.nextCursor)expect(result.nextUrl).toContain('history='+history);cursor=result.nextCursor??undefined;
 }while(cursor);
 expect(ids).toHaveLength(55);expect(new Set(ids).size).toBe(55);
 }
 const board=owned.store.snapshot({kind:'board',id:projectId,input:{limit:50}},now).body.data as {columns:{status:string;total:number;items:unknown[]}[]};
 expect(board.columns).toHaveLength(4);expect(board.columns.reduce((n,c)=>n+c.total,0)).toBe(105);
 }finally{owned.close();}
});
