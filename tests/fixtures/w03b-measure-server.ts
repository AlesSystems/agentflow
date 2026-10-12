import { startRuntime } from "../../src/server/launcher";
import { readConfig } from "../../src/server/config";
const running=await startRuntime(readConfig(process.env,"production"));
const store=running.owned.store,backup=store.backup.bind(store),commit=store.historyCommitPrune.bind(store),preview=store.historyPreview.bind(store),prepare=store.prepareHistoryExport.bind(store);
const backups:{destination:string;ms:number}[]=[];let exportOrdinal=0;
store.backup=async(...args)=>{const at=performance.now();try{return await backup(...args);}finally{const row={destination:args[0],ms:performance.now()-at};backups.push(row);console.log(JSON.stringify({kind:"backupTiming",...row}));}};
store.historyPreview=(...args)=>{const at=performance.now();try{return preview(...args);}finally{console.log(JSON.stringify({kind:"previewTransactionTiming",key:args[1].key,ms:performance.now()-at}));}};
store.historyCommitPrune=(...args)=>{const at=performance.now();try{return commit(...args);}finally{console.log(JSON.stringify({kind:"transactionTiming",key:args[0].context.key,previewId:args[0].input.previewId,ms:performance.now()-at}));}};
store.prepareHistoryExport=async(...args)=>{
 const ordinal=++exportOrdinal,at=performance.now(),snapshot=await prepare(...args),totalMs=performance.now()-at,backupMs=backups.filter(row=>row.destination===args[0]).reduce((sum,row)=>sum+row.ms,0);
 console.log(JSON.stringify({kind:"exportPreparationTiming",destination:args[0],ordinal,totalMs,backupMs,residualMs:totalMs-backupMs,qualification:"Residual includes await scheduling, logging, integrity checks, count queries and opening the copied snapshot"}));
 const next=snapshot.nextBatch.bind(snapshot);let batch=0;
 snapshot.nextBatch=()=>{const at=performance.now(),rows=next();console.log(JSON.stringify({kind:"exportBatchTiming",ordinal,batch:++batch,rows:rows.length,ms:performance.now()-at}));return rows;};
 return snapshot;
};
console.log("AgentFlow measurement ready");
for(const signal of ["SIGINT","SIGTERM"] as const)process.once(signal,()=>void running.shutdown().then(()=>{console.log(JSON.stringify({kind:"shutdown",history:running.history.diagnostics(),runtime:running.diagnostics()}));process.exit(0);}));
