import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { readConfig } from "../server/config";
import { activeAppRoot, inspectManaged, privateDestination } from "../server/filesystem";

export class CliError extends Error {
  constructor(readonly code: string, readonly exit: 1 | 3 = 1) { super(code); }
}
export function readBoundedBytes(path: string, max = 65536, privateFile = false): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > max) throw new CliError("invalid_file");
    if (privateFile) {
      inspectManaged(stat, false);
      if ((stat.mode & 0o777) !== 0o600) throw new CliError("unsafe_token_file");
    }
    const bytes = Buffer.alloc(max + 1);
    let count = 0;
    while (count <= max) {
      const n = readSync(fd, bytes, count, max + 1 - count, null);
      if (!n) break;
      count += n;
    }
    if (count > max) throw new CliError("invalid_file");
    return bytes.subarray(0,count);
  } finally { closeSync(fd); }
}
export function readBounded(path: string,max = 65536,privateFile = false): string {
  return new TextDecoder("utf-8",{fatal:true}).decode(readBoundedBytes(path,max,privateFile));
}
export function readJson(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readBounded(path));
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new CliError("invalid_json");
  return value as Record<string, unknown>;
}
export function cliConfig(port?: string) {
  const env: Record<string, string | undefined> = { ...process.env, ...(port === undefined ? {} : { PORT: port }) };
  const service = readConfig(env);
  const tokenFile = env.AGENTFLOW_REPORTER_TOKEN_FILE;
  if (!tokenFile || !isAbsolute(tokenFile)) throw new CliError("token_file_required");
  privateDestination(tokenFile,activeAppRoot());
  const token = readBounded(tokenFile, 64, true);
  if (!/^[0-9a-f]{64}$/.test(token)) throw new CliError("invalid_token_file");
  const outbox = privateDestination(env.AGENTFLOW_OUTBOX_DIR || join(homedir(), "Library", "Application Support", "AgentFlow-outbox"), activeAppRoot());
  return Object.freeze({ port: service.port, token, outbox, explicitService: env.AGENTFLOW_DATA_DIR ? privateDestination(service.dataDir, activeAppRoot()) : undefined });
}
export type CliConfig = ReturnType<typeof cliConfig>;
export const deadline = () => performance.now() + 5000;
