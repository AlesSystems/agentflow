import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {openOutbox} from '../../src/cli/outbox.ts';
import {canonicalDigest} from '../../src/domain/request-digest.ts';
import {eventInput} from '../../src/contracts/observations.ts';
import {createFile,syncDirectory,syncFile,validateFile} from '../../src/server/filesystem.ts';
const require=createRequire(import.meta.url);
const Database=require('better-sqlite3');
const root=process.argv[2], outbox=join(root,'outbox'),service=join(root,'service');
const facts={allowed:1,used:1,timeline:[],cleanupErrors:[],primaryPresent:false,outcome:'unknown',http:'exact offline settings mock; known persisted association'};
const note=(phase,data={})=>facts.timeline.push({phase,at:performance.now(),...data});
const errorFacts=e=>({name:e?.name??null,code:e?.code??null,message:e?.message??String(e),stack:e?.stack??null});
const original={readdir:fs.readdirSync,lstat:fs.lstatSync,request:http.request,exec:Database.prototype.exec};
let publisher,returned,first,fired=false;
const snapshot=()=>{const files=[];function walk(p){for(const n of original.readdir.call(fs,p)){const q=join(p,n),s=original.lstat.call(fs,q);if(s.isDirectory())walk(q);else{const b=fs.readFileSync(q);files.push({path:q,uid:s.uid,dev:s.dev,inode:s.ino,mode:s.mode&511,nlink:s.nlink,size:s.size,sha256:createHash('sha256').update(b).digest('hex'),base64:b.toString('base64')});}}}walk(outbox);return files;};
createFile(join(root,'attempt.json'),JSON.stringify({allowed:1,used:1,source:'534140b1d0030650a2cbe7f146345a9a0dec4f61'}));
try {
 const runId=randomUUID(),eventId=randomUUID(),generation=randomUUID(),runDir=join(outbox,runId),pub=join(outbox,'publication.sqlite');
 const body=eventInput.parse({schemaVersion:1,eventId,runId,sequence:1,type:'run.started',occurredAt:new Date().toISOString(),payload:{}});
 const record={formatVersion:1,body,digest:canonicalDigest(body)},clean={formatVersion:1,runId,allocatedThrough:1,acknowledgedThrough:0,generation};
 const filename=`1-${eventId}.json`,pending={...clean,pending:{record,filename,remainingPeak:Buffer.byteLength(JSON.stringify(record))+Buffer.byteLength(JSON.stringify(clean))}};
 createFile(join(outbox,'metadata.json'),JSON.stringify({formatVersion:1,port:49153,serviceDataDir:service,generation,cursor:null,nextOrder:0}));
 for(const n of ['publication.sqlite','delivery.sqlite']){const p=join(outbox,n);createFile(p,'');const db=new Database(p);try{db.pragma('user_version=0');}finally{db.close();}syncFile(p);}
 publisher=new Database(pub);publisher.pragma('busy_timeout=0');publisher.exec('BEGIN EXCLUSIVE');note('publisher-BEGIN-EXCLUSIVE');
 const contender=new Database(pub);try{contender.pragma('busy_timeout=0');try{contender.exec('BEGIN EXCLUSIVE');throw new Error('lease unexpectedly available');}catch(e){if(e.code!=='SQLITE_BUSY')throw e;facts.nativeLease=e.code;}}finally{contender.close();}
 fs.mkdirSync(runDir,{mode:0o700});createFile(join(runDir,'state.json'),JSON.stringify(pending));createFile(join(runDir,filename),JSON.stringify(record));createFile(join(runDir,'state.json.tmp'),JSON.stringify(clean));syncDirectory(runDir);
 facts.inputs={runId,eventId,generation,body,record,clean,pending};facts.before=snapshot();
 for(const f of facts.before){validateFile(f.path);if(f.uid!==process.getuid()||f.mode!==0o600||f.nlink!==1)throw new Error('invalid private file');}
 for(const n of ['publication.sqlite','delivery.sqlite']){const b=fs.readFileSync(join(outbox,n));if(b.subarray(0,16).toString()!=='SQLite format 3\0'||b.readUInt32BE(60)!==0)throw new Error('invalid native header');}
 facts.totalBytes=facts.before.reduce((s,f)=>s+f.size,0);if(facts.totalBytes>=65536)throw new Error('fixture exceeds bootstrap bound');
 const finish=()=>{fs.renameSync(join(runDir,'state.json.tmp'),join(runDir,'state.json'));note('publisher-real-rename');syncDirectory(runDir);note('publisher-fsync');Reflect.apply(original.exec,publisher,['COMMIT']);note('publisher-COMMIT');fired=true;};
 fs.readdirSync=function(...args){const value=Reflect.apply(original.readdir,this,args);if(String(args[0])===runDir&&!fired){note('reader-real-snapshot',{entries:value});finish();note('reader-return-stale-snapshot');}return value;};
 fs.lstatSync=function(...args){if(String(args[0])===join(runDir,'state.json.tmp')){note('reader-lstat-temporary');try{return Reflect.apply(original.lstat,this,args);}catch(e){note('reader-real-lstat-error',{code:e.code});throw e;}}return Reflect.apply(original.lstat,this,args);};
 Database.prototype.exec=function(...args){if(this!==publisher&&this.name===pub&&args[0]==='BEGIN EXCLUSIVE'){note('reader-BEGIN-attempt');if(!fired)finish();}return Reflect.apply(original.exec,this,args);};
 http.request=function(...args){const o=args[0];if(o?.hostname==='127.0.0.1'&&Number(o.port)===49153&&o.path==='/api/v1/settings'){note('offline-settings');const e=new Error('controlled offline settings');e.code='ECONNREFUSED';throw e;}throw new Error('unexpected HTTP target');};
 syncBuiltinESMExports();facts.started=performance.now();note('actual-openOutbox-start');
 try{returned=await openOutbox({port:49153,token:'a'.repeat(64),outbox,explicitService:undefined},performance.now()+5000);facts.outcome='returned';}catch(e){first=e;facts.primaryPresent=true;facts.primary=errorFacts(e);facts.outcome='threw';}finally{facts.ended=performance.now();note('actual-openOutbox-end');}
} catch(e){if(!facts.primaryPresent){first=e;facts.primaryPresent=true;facts.primary=errorFacts(e);}facts.outcome='setup-or-control-failure';}
finally {
 fs.readdirSync=original.readdir;fs.lstatSync=original.lstat;http.request=original.request;Database.prototype.exec=original.exec;syncBuiltinESMExports();facts.hooksRestored=true;
 if(returned)try{returned.close();}catch(e){facts.cleanupErrors.push(errorFacts(e));}
 if(publisher){try{if(publisher.inTransaction)publisher.exec('ROLLBACK');}catch(e){facts.cleanupErrors.push(errorFacts(e));}try{publisher.close();}catch(e){facts.cleanupErrors.push(errorFacts(e));}}
 try{facts.after=snapshot();}catch(e){facts.inspectionError=errorFacts(e);}
 facts.firstIdentityPreserved=facts.primaryPresent?first!==undefined:null;
 createFile(join(root,'result.json'),JSON.stringify(facts,null,2));
 assert.equal(facts.outcome,'returned');
 assert.equal(facts.nativeLease,'SQLITE_BUSY');
 assert.equal(facts.cleanupErrors.length,0);
 const phases=facts.timeline.map(x=>x.phase);
 assert(phases.indexOf('reader-BEGIN-attempt')<phases.indexOf('publisher-real-rename'));
 assert(!phases.includes('reader-return-stale-snapshot'));
 const state=facts.after.find(x=>x.path.endsWith('/state.json'));
 assert.deepEqual(JSON.parse(Buffer.from(state.base64,'base64')),facts.inputs.clean);
 const before=facts.before.find(x=>x.path.endsWith(`/${facts.inputs.pending.pending.filename}`));
 const after=facts.after.find(x=>x.path===before.path);
 assert.equal(after.sha256,before.sha256);
 assert.equal(facts.inputs.record.digest,canonicalDigest(facts.inputs.body));
}
