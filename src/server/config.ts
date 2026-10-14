import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
export type RuntimeConfig = Readonly<{
  dataDir: string;
  githubTokenFile?: string;
  codexExecutable?: string;
  claudeDir: string;
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
  const codexExecutable = env.AGENTFLOW_CODEX_EXECUTABLE;
  if (codexExecutable && !isAbsolute(codexExecutable))
    throw new Error("ABSOLUTE_CODEX_EXECUTABLE_REQUIRED");
  if (env.AGENTFLOW_CLAUDE_DIR && !isAbsolute(env.AGENTFLOW_CLAUDE_DIR))
    throw new Error("ABSOLUTE_CLAUDE_DIR_REQUIRED");
  const claudeDir =
    env.AGENTFLOW_CLAUDE_DIR ||
    (env.CLAUDE_CONFIG_DIR && isAbsolute(env.CLAUDE_CONFIG_DIR) ? env.CLAUDE_CONFIG_DIR : join(homedir(), ".claude"));
  return { dataDir, claudeDir, host: "127.0.0.1", port, mode, ...(env.AGENTFLOW_GITHUB_TOKEN_FILE ? {githubTokenFile:env.AGENTFLOW_GITHUB_TOKEN_FILE} : {}), ...(codexExecutable ? { codexExecutable } : {}) };
}
