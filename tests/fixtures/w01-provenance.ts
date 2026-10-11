import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
export function sourceProvenance(root = process.cwd()) {
  const files: Record<string, string> = {};
  function walk(path: string) {
    if (!existsSync(path)) return;
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else files[relative(root, full)] = hash(readFileSync(full));
    }
  }
  for (const name of ["src", "migrations", "public"]) walk(join(root, name));
  for (const name of [
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "tsconfig.json",
  ])
    files[name] = hash(readFileSync(join(root, name)));
  const probe = new Database(":memory:");
  probe.close();
  const require = createRequire(import.meta.url),
    addon = Object.keys(require.cache).find(
      (path) => path.includes("better-sqlite3") && path.endsWith(".node"),
    );
  const buildIdPath = join(root, ".next", "BUILD_ID");
  return {
    root,
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    workingDiffSha256: hash(
      execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: root }),
    ),
    appInputFiles: files,
    appInputSha256: hash(JSON.stringify(files)),
    node: process.version,
    nodeExecutableSha256: hash(readFileSync(process.execPath)),
    sqliteAddonSha256: addon ? hash(readFileSync(addon)) : null,
    buildId: existsSync(buildIdPath)
      ? readFileSync(buildIdPath, "utf8").trim()
      : null,
    helperHashes: Object.fromEntries(
      [
        "tests/fixtures/w01-provenance.ts",
        "tests/fixtures/w01-producer.ts",
      "tests/fixtures/w01-legacy.ts",
      "tests/fixtures/p03.ts",
      "tests/fixtures/p06-cli.ts",
        "tests/fixtures/server.ts",
        "tests/e2e/w01-workflows.spec.ts",
        "tests/e2e/w01-accessibility.spec.ts",
      ]
        .filter((path) => existsSync(join(root, path)))
        .map((path) => [path, hash(readFileSync(join(root, path)))]),
    ),
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const output = process.argv[2];
  if (!output || existsSync(output))
    throw new Error("fresh owned provenance output required");
  writeFileSync(output, JSON.stringify(sourceProvenance(), null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
}
