import { expect, it } from "vitest";
import { invokeCli } from "../fixtures/w01-legacy-performance";
it("keeps the EXIT clock while draining complete trailing stdout/stderr through CLOSE", async () => {
  const result = await invokeCli(
    process.cwd(),
    [],
    {},
    "tests/fixtures/w01-cli-trailing-output.mjs",
  );
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("initial stdout\ntrailing stdout Ω\n");
  expect(result.stderr).toBe("initial stderr\ntrailing stderr ě\n");
  expect(result.completedMs).toBeGreaterThan(result.dispatchMs);
  expect(result.exitMs).toBe(result.completedMs);
  expect(result.drainedMs).toBeGreaterThan(result.completedMs + 100);
  expect(result.elapsedEndpoint).toBe("exit");
  expect(result.errors).toEqual([]);
  expect(result.elapsedMs).toBe(result.completedMs - result.dispatchMs);
});
