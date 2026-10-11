import { startRuntime } from "../../src/server/launcher";
import { readConfig } from "../../src/server/config";
const target=process.env.W03A_FIXTURE_ORIGIN!;
const transport:typeof fetch=(url,init)=>fetch(String(url).replace("https://api.github.com",target),init);
const running=await startRuntime(readConfig(),{githubTransport:transport});
console.log("W03a fixture runtime ready");
for(const signal of ["SIGTERM","SIGINT"] as const)process.once(signal,()=>{void running.shutdown().then(()=>process.exit(0));});
