import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import { stop } from "../fixtures/server";
it("stops an already SIGKILL-exited fixture without waiting for a second exit event", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill("SIGKILL");
  await exited;
  expect(child.exitCode).toBeNull();
  expect(child.signalCode).toBe("SIGKILL");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      stop(child).then(() => "stopped"),
      new Promise<string>(
        (resolve) => (timer = setTimeout(() => resolve("hung"), 250)),
      ),
    ]);
    expect(result).toBe("stopped");
  } finally {
    clearTimeout(timer);
  }
});
