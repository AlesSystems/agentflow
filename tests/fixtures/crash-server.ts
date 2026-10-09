import { startRuntime } from "../../src/server/launcher";
import { readConfig } from "../../src/server/config";
const running = await startRuntime(readConfig(process.env, "production"));
const original = running.owned.store.command.bind(running.owned.store);
running.owned.store.command = (command, context) => {
  if (context.key !== process.env.AGENTFLOW_TEST_KEY)
    return original(command, context);
  if (process.env.AGENTFLOW_TEST_CRASH === "before")
    return running.owned.store.transaction(() => {
      original(command, context);
      process.kill(process.pid, "SIGKILL");
      throw new Error("unreachable");
    });
  const result = original(command, context);
  process.kill(process.pid, "SIGKILL");
  return result;
};
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () => void running.shutdown().then(() => process.exit(0)),
  );
