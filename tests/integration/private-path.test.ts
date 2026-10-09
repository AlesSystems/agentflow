import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { launch } from "../fixtures/server";
function fixtureApp() {
  const app = mkdtempSync(
    join(realpathSync(tmpdir()), "agentflow-private-app-"),
  );
  for (const name of [
    "src",
    "migrations",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "next.config.ts",
    "postcss.config.mjs",
    "next-env.d.ts",
    ".next",
  ])
    cpSync(name, join(app, name), { recursive: true });
  symlinkSync(join(process.cwd(), "node_modules"), join(app, "node_modules"));
  mkdirSync(join(app, "public"), { mode: 0o700 });
  return app;
}
it("refuses a served public data directory before writing or listening", async () => {
  const app = fixtureApp();
  const dir = join(app, "public", "private-fixture");
  let server: Awaited<ReturnType<typeof launch>> | undefined;
  let refused = false;
  let exposed = false;
  try {
    try {
      server = await launch({ cwd: app, dir });
    } catch (error) {
      expect(String(error)).toContain("PRIVATE_PATH_INSIDE_APP");
      refused = true;
    }
    if (server) {
      const response = await fetch(
        server.url + "/private-fixture/credentials.json",
      );
      if (response.status === 200) {
        const body = await response.json();
        exposed =
          typeof body.pairingToken === "string" &&
          typeof body.reporterToken === "string";
      }
    }
  } finally {
    await server?.stop();
  }
  expect({ refused, exposed }).toEqual({ refused: true, exposed: false });
  expect(existsSync(dir)).toBe(false);
});
it("shared maintenance guard rejects missing inside-root directories without mutations", () => {
  const app = fixtureApp();
  const dir = join(app, "nested", "private-data");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli/local.ts", "setup"],
    {
      cwd: app,
      env: { ...process.env, AGENTFLOW_DATA_DIR: dir },
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("PRIVATE_PATH_INSIDE_APP");
  expect(existsSync(join(app, "nested"))).toBe(false);
});
it("rejects inside-root backups and explicit candidates while retaining existing sentinel bytes", () => {
  const app = fixtureApp();
  const outside = mkdtempSync(
    join(realpathSync(tmpdir()), "agentflow-private-store-"),
  );
  const existing = join(app, "public", "keep.sqlite");
  writeFileSync(existing, "sentinel", { mode: 0o600 });
  const script = `import {openOwnedStore,Store} from './src/db/index.ts';import {existsSync} from 'node:fs';const owned=await openOwnedStore(process.env.AGENTFLOW_DATA_DIR);let rejected=0;for(const destination of ['public/keep.sqlite','new-parent/backup.sqlite']){try{await owned.store.backup(process.cwd()+'/'+destination);}catch(error){if(error.message.startsWith('PRIVATE_PATH_INSIDE_APP'))rejected++;}}try{new Store(owned.instance,process.cwd()+'/new-candidate/database.sqlite');}catch(error){if(error.message.startsWith('PRIVATE_PATH_INSIDE_APP'))rejected++;}owned.close();console.log(JSON.stringify({rejected,newParent:existsSync('new-parent'),newCandidate:existsSync('new-candidate')}));`;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      cwd: app,
      env: { ...process.env, AGENTFLOW_DATA_DIR: outside },
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    rejected: 3,
    newParent: false,
    newCandidate: false,
  });
  expect(readFileSync(existing, "utf8")).toBe("sentinel");
});
it("uses the frozen active root for backups and creates only the normalized external data path", () => {
  const app = fixtureApp();
  const outside = app + "-data";
  const raw = app + "/discarded/../../" + outside.split("/").at(-1);
  const script = `import {openOwnedStore} from './src/db/index.ts';import {existsSync} from 'node:fs';const app=process.cwd();const owned=await openOwnedStore(process.env.AGENTFLOW_DATA_DIR);const destination=owned.store.dataDir;process.chdir(destination);let blocked=false;try{await owned.store.backup(app+'/public/new.sqlite');}catch(error){blocked=error.message.startsWith('PRIVATE_PATH_INSIDE_APP');}owned.close();console.log(JSON.stringify({blocked,discarded:existsSync(app+'/discarded'),external:existsSync(destination+'/credentials.json')}));`;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      cwd: app,
      env: { ...process.env, AGENTFLOW_DATA_DIR: raw },
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    blocked: true,
    discarded: false,
    external: true,
  });
  expect(existsSync(join(app, "public", "new.sqlite"))).toBe(false);
});
