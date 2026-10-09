import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { openOwnedStore } from '../../src/db';
import type { ApplicationCommand } from '../../src/db/application';
import { canonicalDigest } from '../../src/domain/request-digest';
it('registers stable identities and immutable attempts without adopting legacy registration identity', async () => {
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'agentflow-p04-'));
 const owned=await openOwnedStore(dir);
 const db=new Database(join(dir,'agentflow.sqlite'),{readonly:true});
 try {
 const send=(command:ApplicationCommand,key=randomUUID(),now=1000)=>owned.store.command(command,{principal:'reporter',method:'POST',path:command.kind,key,digest:canonicalDigest(command.input),now});
 const projectId=(send({kind:'project.create',input:{name:'Synthetic'}}).body.data as {id:string}).id;
 const taskId=(send({kind:'task.create',input:{projectId,title:'Synthetic'}}).body.data as {id:string}).id;
 const agentId=(send({kind:'agent.create',input:{displayName:'Synthetic',source:'fixture',defaultRole:'implementation'}}).body.data as {id:string}).id;
 const input={id:randomUUID(),projectId,taskId,agentId,purpose:'implementation' as const,expectedTaskVersion:1};
 const key=randomUUID();
 const first=send({kind:'run.register',input},key);
 expect(first.status).toBe(201);
 expect(first.body.data).toMatchObject({id:input.id,state:'queued',workRevision:2,version:1,lastSequence:0});
 expect(send({kind:'run.register',input},key)).toEqual(first);
 const retry=send({kind:'run.register',input});
 expect(retry).toEqual({...first,status:200});
 expect(()=>send({kind:'run.register',input:{...input,expectedTaskVersion:2}})).toThrow('run_conflict');
 expect(()=>send({kind:'run.register',input:{...input,id:randomUUID(),expectedTaskVersion:2}})).toThrow('active_run');
 expect(db.prepare('SELECT version,work_revision FROM tasks WHERE id=?').get(taskId)).toEqual({version:2,work_revision:2});
 expect(db.prepare('SELECT last_value FROM run_order_allocator').get()).toEqual({last_value:1});
 expect(db.prepare('SELECT count(*) AS n FROM runs').get()).toEqual({n:1});
 expect(db.prepare('SELECT count(*) AS n FROM run_registrations').get()).toEqual({n:1});
 } finally {db.close();owned.close();}
});
