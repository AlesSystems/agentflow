import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { launch, pair } from "./server";
import { openOwnedStore } from "../../src/db";
const samples: { readyMs: number; idleRssKiB: number }[] = [];
const evidence: unknown[] = [];
mkdirSync("work/poteto/P01", { recursive: true });
for (let i = 0; i < 3; i++) {
  const start = Date.now();
  const server = await launch();
  const readyMs = Date.now() - start;
  try {
    const listener = spawnSync(
      "lsof",
      ["-nP", `-iTCP:${server.port}`, "-sTCP:LISTEN"],
      { encoding: "utf8" },
    );
    if (
      listener.status !== 0 ||
      !listener.stdout.includes("127.0.0.1:" + server.port) ||
      listener.stdout.includes("*:" + server.port)
    )
      throw new Error("Listener not loopback");
    const health = await fetch(server.url + "/api/v1/health");
    const unauth = await fetch(server.url + "/api/v1/foundation");
    const cookie = await pair(server);
    const authenticated = await fetch(server.url + "/api/v1/foundation", {
      headers: { Cookie: cookie },
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const rss = spawnSync(
      "ps",
      ["-o", "rss=", "-p", String(server.child.pid)],
      { encoding: "utf8" },
    );
    if (rss.status !== 0) throw new Error("RSS unavailable");
    const idleRssKiB = Number(rss.stdout.trim());
    samples.push({ readyMs, idleRssKiB });
    evidence.push({
      listener: listener.stdout
        .split("\n")
        .filter((line) => line.includes("(LISTEN)"))
        .map((line) => line.match(/TCP ([^ ]+) \(LISTEN\)/)?.[0]),
      health: { status: health.status, body: await health.json() },
      unauthenticated: { status: unauth.status, body: await unauth.json() },
      authenticated: {
        status: authenticated.status,
        body: await authenticated.json(),
      },
      idleSeconds: 3,
    });
  } finally {
    await server.stop();
  }
  const owned = await openOwnedStore(server.dir);
  evidence.push({
    integrity: owned.store.integrity(),
    pragmas: owned.store.pragmas(),
  });
  owned.close();
}
const bundleScan = spawnSync(
  "rg",
  ["-l", "better-sqlite3|node:fs|pairingToken|reporterToken", ".next/static"],
  { encoding: "utf8" },
);
if (bundleScan.status !== 1)
  throw new Error("Server import or credential name in browser bundles");
writeFileSync(
  "work/poteto/P01/acceptance.json",
  JSON.stringify(
    {
      host: {
        node: process.version,
        npm: spawnSync("npm", ["--version"], {
          encoding: "utf8",
        }).stdout.trim(),
        macOS: spawnSync("sw_vers", [], { encoding: "utf8" }).stdout.trim(),
        architecture: process.arch,
      },
      lockSha256: createHash("sha256")
        .update(readFileSync("package-lock.json"))
        .digest("hex"),
      shippingBuildId: readFileSync(".next/BUILD_ID", "utf8"),
      samples,
      evidence,
      browserBundleScan: "no matches",
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ samples, browserBundleScan: "no matches" }));
