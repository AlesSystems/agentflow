import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
export type RuntimeConfig = Readonly<{
  dataDir: string;
  host: "127.0.0.1";
  port: number;
  mode: "development" | "production";
}>;
export function readConfig(
  env: Record<string, string | undefined> = process.env,
  mode: RuntimeConfig["mode"] = "production",
): RuntimeConfig {
  if (process.version !== "v24.15.0")
    throw new Error("NODE_VERSION_REQUIRED: Use Node 24.15.0.");
  const port = Number(env.PORT || 3000);
  if (
    !/^\d+$/.test(env.PORT || "3000") ||
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65535
  )
    throw new Error("INVALID_PORT");
  const dataDir =
    env.AGENTFLOW_DATA_DIR ||
    join(homedir(), "Library", "Application Support", "AgentFlow");
  if (!isAbsolute(dataDir)) throw new Error("ABSOLUTE_DATA_DIR_REQUIRED");
  return { dataDir, host: "127.0.0.1", port, mode };
}
