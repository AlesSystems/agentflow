import { startRuntime } from "../../src/server/launcher";
import { readConfig } from "../../src/server/config";
const running=await startRuntime(readConfig(process.env,"production"));
const backup=running.owned.store.backup.bind(running.owned.store),commit=running.owned.store.historyCommitPrune.bind(running.owned.store);
running.owned.store.backup=async(...args)=>{const at=performance.now();try{return await backup(...args);}finally{console.log(JSON.stringify({kind:"backupTiming",ms:performance.now()-at}));}};
running.owned.store.historyCommitPrune=(...args)=>{const at=performance.now();try{return commit(...args);}finally{console.log(JSON.stringify({kind:"transactionTiming",ms:performance.now()-at}));}};
console.log("AgentFlow measurement ready");
for(const signal of ["SIGINT","SIGTERM"] as const)process.once(signal,()=>void running.shutdown().then(()=>{console.log(JSON.stringify({kind:"shutdown",history:running.history.diagnostics(),runtime:running.diagnostics()}));process.exit(0);}));
