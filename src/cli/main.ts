import { z } from "zod";
import { uuid } from "../contracts/common";
import { projectCreate } from "../contracts/projects";
import { taskCreate } from "../contracts/tasks";
import { agentCreate, agentResponse, runRegister, runResponse } from "../contracts/observations";
import { projectResponse, taskResponse } from "../contracts/responses";
import { CliError, cliConfig, deadline, readJson } from "./config";
import { request } from "./http";
import { openOutbox } from "./outbox";
const commands = {
  "project create": { path: "/projects", input: projectCreate, output: projectResponse },
  "task create": { path: "/tasks", input: taskCreate, output: taskResponse },
  "agent register": { path: "/agents", input: agentCreate, output: agentResponse },
  "run register": { path: "/runs", input: runRegister, output: runResponse },
} as const;
export async function main(args = process.argv.slice(2)) {
  const end = deadline();
  let outbox: Awaited<ReturnType<typeof openOutbox>> | undefined;
  try {
    if (args.length === 1 && ["--help", "help"].includes(args[0])) { process.stdout.write("agentflow project create | task create | agent register | run register --file <json> --idempotency-key <uuid> [--port <port>]\n"); return 0; }
    const command = commands[args.slice(0,2).join(" ") as keyof typeof commands];
    if (!command) throw new CliError("invalid_command");
    const flags: Record<string,string> = {};
    for (let i = 2; i < args.length; i += 2) {
      const flag = args[i];
      if (!["--file", "--idempotency-key", "--port"].includes(flag) || flags[flag] !== undefined || !args[i+1] || args[i+1].startsWith("--")) throw new CliError("invalid_arguments");
      flags[flag] = args[i+1];
    }
    if (!flags["--file"] || !uuid.safeParse(flags["--idempotency-key"]).success) throw new CliError("invalid_arguments");
    const config = cliConfig(flags["--port"]);
    const body = readJson(flags["--file"]);
    if (!command.input.safeParse(body).success || Buffer.byteLength(JSON.stringify(body)) > 65536) throw new CliError("invalid_input");
    outbox = await openOutbox(config, end);
    const record = await outbox.preserveRegistration(command.path, flags["--idempotency-key"], body);
    let attempt = 0;
    while (performance.now() < end) {
      const reply = await request(config, record.path, command.output as z.ZodType<{ data: { id: string } }>, end, record.body, record.key);
      if (reply.kind === "blocked") { process.stderr.write(JSON.stringify({ code: reply.code, repair: "Preserve the outbox and resolve the rejected registration." }) + "\n"); return 3; }
      if (reply.kind === "delivered") {
        if (record.path === "/runs") {
          const initialized = await outbox.initializeRun(reply.data.data.id);
          if (initialized.kind === "blocked") throw new CliError(initialized.code,3);
          if (initialized.kind === "retryable") continue;
        }
        await outbox.removeRegistration(record);
        process.stdout.write(JSON.stringify({ id: reply.data.data.id, generation: reply.generation }) + "\n"); return 0;
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(reply.delay, Math.random()*Math.min(30000,100*2**attempt++)), Math.max(0,end-performance.now()))));
    }
    process.stderr.write(JSON.stringify({ code: "queued", repair: "Retry the same file and idempotency key." }) + "\n"); return 2;
  } catch (error) {
    const known = error instanceof CliError;
    process.stderr.write(JSON.stringify({ code: known ? error.code : "local_failure", repair: "Preserve the outbox and verify input, permissions and local storage." }) + "\n");
    return known ? error.exit : 1;
  } finally { outbox?.close(); }
}
if (import.meta.url === new URL(process.argv[1], "file:").href) process.exitCode = await main();
