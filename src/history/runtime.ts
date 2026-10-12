import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { Conflict } from "../domain/tasks";
import type { CommandContext, CommittedReply } from "../db/application";
import type { Store } from "../db";
import { retentionPruneInput, parseHistoryExportRequest, type HistoryExportSnapshot, type RetentionPruneInput } from "../contracts/history";
import { secureDirectory, inspectManaged } from "../server/filesystem";
import { runtime } from "../server/runtime";
import { authenticate, HttpError } from "../server/security";
const childName=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const files=new Set(["snapshot.sqlite","snapshot.sqlite-wal","snapshot.sqlite-shm","snapshot.sqlite-journal"]);
type Identity={dev:number;ino:number};
function cleanup(parent:string,name:string,identity?:Identity) {
  if(!childName.test(name))return;
  const dir=join(parent,name);
  try {
    const stat=lstatSync(dir);inspectManaged(stat,true);
    if((stat.mode&0o777)!==0o700 || identity && (stat.dev!==identity.dev || stat.ino!==identity.ino))return;
    const entries=readdirSync(dir);
    for(const entry of entries){if(!files.has(entry))return;const file=lstatSync(join(dir,entry));inspectManaged(file,false);if((file.mode&0o777)!==0o600 || file.nlink!==1)return;}
    for(const entry of entries)unlinkSync(join(dir,entry));
    rmdirSync(dir);
  }catch { /* Uncertain paths are retained for operator repair. */ }
}
export class HistoryRuntime {
  private closing=false;
  private readonly parent:string;
  private readonly leases=new Map<AbortController,Promise<void>>();
  private pruneWork?:{context:CommandContext;controller:AbortController;result:Promise<CommittedReply>};
  private peakBytes=0;
  private stalledCloses=0;
  constructor(private readonly store:Store) {
    this.parent=secureDirectory(join(store.dataDir,"exports"));
    for(const name of readdirSync(this.parent))cleanup(this.parent,name);
  }
  diagnostics(){return {leases:this.leases.size,peakBytes:this.peakBytes,stalledCloses:this.stalledCloses};}
  beginClosing(){this.closing=true;for(const controller of this.leases.keys())controller.abort();}
  async close(){this.beginClosing();await Promise.allSettled([...this.leases.values()]);}
  async prune(input:RetentionPruneInput,context:CommandContext,signal:AbortSignal):Promise<CommittedReply> {
    if(this.closing)throw new HttpError(503,"unavailable");
    if(context.principal!=="operator")throw new Conflict("human_required");
    input=retentionPruneInput.parse(input);
    let work=this.pruneWork;
    if(work) {
      const prior=work.context;
      if(prior.principal!==context.principal||prior.method!==context.method||prior.path!==context.path||prior.key!==context.key)throw new HttpError(409,"retention_busy");
      if(prior.digest!==context.digest)throw new HttpError(409,"idempotency_conflict");
    }else {
      // Admission recovers original receipts before checking guards, with no retained transaction.
      const admission=this.store.historyAdmitPrune(input,context);
      if("body" in admission)return admission;
      signal.throwIfAborted();
      const controller=new AbortController();
      let resolve!:()=>void;const settled=new Promise<void>(value=>{resolve=value;});
      this.leases.set(controller,settled);
      const result=(async()=>{
        try {
          controller.signal.throwIfAborted();
          const parent=secureDirectory(join(this.store.dataDir,"backups"));
          await this.store.backup(join(parent,"retention-"+randomUUID()+".sqlite"),controller.signal);
          controller.signal.throwIfAborted();
          return this.store.historyCommitPrune(admission,Date.now());
        }finally {this.pruneWork=undefined;this.leases.delete(controller);resolve();}
      })();
      work={context,controller,result};this.pruneWork=work;
    }
    const abort=()=>work.controller.abort();
    signal.addEventListener("abort",abort,{once:true});
    if(signal.aborted)abort();
    try{return await work.result;}finally{signal.removeEventListener("abort",abort);}
  }
  async serveExport(request:IncomingMessage,response:ServerResponse,headers:Headers,url:URL):Promise<void> {
    if(this.closing)throw new HttpError(503,"unavailable");
    const state=runtime();
    const authorize=()=>authenticate(headers,this.store,state.owned.credentials,"human");
    authorize();
    let input;
    try{input=parseHistoryExportRequest(url);}catch{throw new HttpError(400,"query_invalid");}
    const generation=this.store.metadata().generation;
    response.setHeader("AgentFlow-Generation",generation);
    if(input.generation!==generation)throw new HttpError(409,"generation_changed");
    if(request.method==="HEAD"){response.statusCode=200;response.end();return;}
    if(this.leases.size>=2)throw new HttpError(429,"export_limit");
    const controller=new AbortController();
    let resolve!:()=>void;const done=new Promise<void>(value=>{resolve=value;});
    this.leases.set(controller,done);
    const abort=()=>controller.abort();
    request.on("aborted",abort);response.on("close",abort);
    const lifetime=setTimeout(abort,300000);
    const name=randomUUID();const dir=join(this.parent,name);
    let identity:Identity|undefined;let snapshot:HistoryExportSnapshot|undefined;
    const check=()=>{controller.signal.throwIfAborted();authorize();};
    const write=async (line:unknown)=> {
      check();
      const buffer=Buffer.from(JSON.stringify(line)+"\n");
      if(response.writableLength+buffer.length>1048576)throw new Error("EXPORT_OUTPUT_LIMIT");
      const writable=response.write(buffer);
      this.peakBytes=Math.max(this.peakBytes,response.writableLength);
      if(writable)return;
      await new Promise<void>((resolve,reject)=> {
        const finish=(error?:Error)=>{clearTimeout(timer);response.off("drain",drain);controller.signal.removeEventListener("abort",cancel);if(error)reject(error);else resolve();};
        const drain=()=>finish();const cancel=()=>finish(new Error("EXPORT_ABORTED"));
        const timer=setTimeout(()=>{this.stalledCloses++;controller.abort();},5000);
        response.once("drain",drain);controller.signal.addEventListener("abort",cancel,{once:true});
        if(controller.signal.aborted)cancel();
      });
      check();
    };
    try {
      check();mkdirSync(dir,{mode:0o700});identity=lstatSync(dir);
      snapshot=await this.store.prepareHistoryExport(join(dir,"snapshot.sqlite"),input,controller.signal);
      check();
      response.setHeader("AgentFlow-Generation",this.store.metadata().generation);
      response.setHeader("Content-Type","application/x-ndjson");
      response.setHeader("Cache-Control","no-store");
      response.setHeader("Content-Disposition",'attachment; filename="agentflow-history.jsonl"');
      response.flushHeaders();
      await write(snapshot.manifest);
      for(;;){check();const batch=snapshot.nextBatch();if(!batch.length)break;for(const record of batch)await write(record);await yieldTurn();}
      await write({kind:"complete",schemaVersion:1,counts:snapshot.manifest.counts});
      await new Promise<void>((resolve,reject)=> {
        let settled=false;
        const settle=(error?:Error)=> {
          if(settled)return;
          settled=true;clearTimeout(timer);
          response.off("finish",finish);response.off("close",closed);
          controller.signal.removeEventListener("abort",cancel);
          if(error){response.destroy();reject(error);}else resolve();
        };
        const finish=()=>settle();
        const closed=()=>settle(new Error("EXPORT_ABORTED"));
        const cancel=()=>settle(new Error("EXPORT_ABORTED"));
        const timer=setTimeout(()=>{this.stalledCloses++;controller.abort();},5000);
        response.once("finish",finish);response.once("close",closed);
        controller.signal.addEventListener("abort",cancel,{once:true});
        if(controller.signal.aborted)cancel();
        else if(response.destroyed)closed();
        else {
          try {response.end();}
          catch(error){settle(error instanceof Error ? error : new Error("EXPORT_ABORTED"));}
        }
      });
    }catch {
      if(response.headersSent)response.destroy();
      else if(!controller.signal.aborted) {
        response.setHeader("AgentFlow-Generation",this.store.metadata().generation);
        throw new HttpError(503,"unavailable");
      }
      else response.destroy();
    }finally {
      clearTimeout(lifetime);request.off("aborted",abort);response.off("close",abort);
      try { snapshot?.close(); } finally {
        if(identity)cleanup(this.parent,name,identity);
        this.leases.delete(controller);resolve();
      }
    }
  }
}
