import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
process.on("SIGTERM", () => {});
writeFileSync(
  join(process.env.AGENTFLOW_DATA_DIR, "owned-health-pid"),
  String(process.pid),
  { mode: 0o600 },
);
createServer(() => {}).listen(Number(process.env.PORT), "127.0.0.1");
