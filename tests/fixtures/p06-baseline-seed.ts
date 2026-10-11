import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [fixture,dir,counts,output]=process.argv.slice(2);
const {seedPerformance}=await import(pathToFileURL(fixture).href);
writeFileSync(output,JSON.stringify(await seedPerformance(dir,JSON.parse(counts)))+"\n",{mode:0o600,flag:"wx"});
