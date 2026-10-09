import {
  cpSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { launch, pair } from "../fixtures/server";
it("built Next flushes a first chunk before a latch releases the second and cancels on abort", async () => {
  const fixture = join(process.cwd(), "work/poteto/P01/stream-app");
  mkdirSync(fixture, { recursive: true });
  for (const name of [
    "src",
    "migrations",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "next.config.ts",
    "postcss.config.mjs",
    "next-env.d.ts",
  ])
    cpSync(name, join(fixture, name), { recursive: true });
  if (!existsSync(join(fixture, "node_modules")))
    symlinkSync(
      join(process.cwd(), "node_modules"),
      join(fixture, "node_modules"),
    );
  const route = join(fixture, "src/app/api/v1/proof/route.ts");
  mkdirSync(join(route, ".."), { recursive: true });
  writeFileSync(route, readFileSync("tests/fixtures/stream-route.txt"));
  const build = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "build", "--webpack"],
    {
      cwd: fixture,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  build.stdout.on("data", (chunk) => (output += chunk));
  build.stderr.on("data", (chunk) => (output += chunk));
  const code = await new Promise<number | null>((resolve) =>
    build.once("exit", resolve),
  );
  writeFileSync("work/poteto/P01/stream-build.log", output);
  expect(code, output).toBe(0);
  const server = await launch({ cwd: fixture });
  try {
    const cookie = await pair(server);
    const headers = { Cookie: cookie };
    const response = await fetch(server.url + "/api/v1/proof", { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("AgentFlow-Generation")).toBeTruthy();
    const reader = response.body!.getReader();
    const firstAt = Date.now();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("first\n");
    let secondArrived = false;
    const secondRead = reader.read().then((chunk) => {
      secondArrived = true;
      return chunk;
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(secondArrived).toBe(false);
    const releaseAt = Date.now();
    await fetch(server.url + "/api/v1/proof", {
      method: "POST",
      headers: {
        ...headers,
        Origin: server.url,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "release" }),
    });
    const second = await secondRead;
    expect(new TextDecoder().decode(second.value)).toBe("second\n");
    expect((await reader.read()).done).toBe(true);
    const abort = new AbortController();
    const aborted = await fetch(server.url + "/api/v1/proof", {
      headers,
      signal: abort.signal,
    });
    await aborted.body!.getReader().read();
    abort.abort();
    let cancelled = 0;
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      cancelled = (
        await (
          await fetch(server.url + "/api/v1/proof", {
            method: "POST",
            headers: {
              ...headers,
              Origin: server.url,
              "Content-Type": "application/json",
            },
            body: '{"action":"stats"}',
          })
        ).json()
      ).cancelled;
      if (cancelled) break;
    }
    expect(cancelled).toBe(1);
    writeFileSync(
      "work/poteto/P01/stream-evidence.json",
      JSON.stringify(
        {
          fixtureBuildId: readFileSync(join(fixture, ".next/BUILD_ID"), "utf8"),
          shippingBuildId: readFileSync(".next/BUILD_ID", "utf8"),
          fixtureRouteSha256: createHash("sha256")
            .update(readFileSync(route))
            .digest("hex"),
          first: "first\\n",
          second: "second\\n",
          firstAt,
          releaseAt,
          secondAt: Date.now(),
          cancelled,
        },
        null,
        2,
      ),
    );
  } finally {
    await server.stop();
  }
  expect(existsSync("src/app/api/v1/proof")).toBe(false);
}, 120000);
