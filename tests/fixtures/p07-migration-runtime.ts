import { startRuntime } from "../../src/server/launcher";
import { readConfig } from "../../src/server/config";
const running = await startRuntime(readConfig(process.env,"production"));
process.once("SIGTERM",()=>void running.shutdown().then(()=>process.exit(0)));
