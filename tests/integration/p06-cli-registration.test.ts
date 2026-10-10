import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { launch } from "../fixtures/server";

async function cli(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli/main.ts", ...args], {
    env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => stdout += chunk);
  child.stderr.on("data", chunk => stderr += chunk);
  const code = await new Promise<number | null>(resolve => child.on("exit", resolve));
  return { code, stdout, stderr };
}

it("creates through the production public API and replays original registration without exposing private fields", async () => {
  const server = await launch();
  const fixture = mkdtempSync(join(realpathSync(tmpdir()), "agentflow-p06-registration-"));
  const token = join(fixture, "token");
  writeFileSync(token, server.credentials().reporterToken, { mode: 0o600 });
  const file = join(fixture, "project.json");
  const secret = "PRIVATE-P06-REPOSITORY-SENTINEL";
  writeFileSync(file, JSON.stringify({ name: "  Synthetic P06  ", repositoryPath: secret }));
  const env = { PORT: String(server.port), AGENTFLOW_REPORTER_TOKEN_FILE: token, AGENTFLOW_OUTBOX_DIR: join(fixture, "outbox") };
  const key = randomUUID();
  const args = ["project", "create", "--file", file, "--idempotency-key", key];
  try {
    const first = await cli(args, env);
    expect(first.code).toBe(0);
    const output = JSON.parse(first.stdout);
    expect(Object.keys(output).sort()).toEqual(["generation", "id"]);
    expect(first.stdout + first.stderr).not.toContain(secret);
    expect((await cli(args, env)).stdout).toBe(first.stdout);
    const db = new Database(join(server.dir, "agentflow.sqlite"), { readonly: true });
    try {
      expect(db.prepare("SELECT name, repository_path FROM projects WHERE id=?").get(output.id)).toEqual({ name: "Synthetic P06", repository_path: secret });
      expect(db.prepare("SELECT count(*) n FROM projects").get()).toEqual({ n: 1 });
    } finally { db.close(); }
  } finally { await server.stop(); }
});

it("retains a run registration until current public GET proves sequence zero and durable initialization succeeds", async () => {
  const { cliFixture } = await import("../fixtures/p06-cli");
  const server = await launch();
  const fixture = cliFixture(server);
  const create = async (args: string[], body: unknown) => {
    const result = await fixture.cli([...args,"--file",fixture.file(body),"--idempotency-key",randomUUID()]);
    expect(result.code).toBe(0);
    return JSON.parse(result.stdout).id as string;
  };
  try {
    const projectId = await create(["project","create"],{name:"Synthetic"});
    const agentId = await create(["agent","register"],{displayName:"Synthetic",source:"fixture",defaultRole:"implementation"});
    const runId = randomUUID().toUpperCase();
    const key = randomUUID();
    const file = fixture.file({id:runId,projectId,agentId,purpose:"planning"});
    const first = await fixture.cli(["run","register","--file",file,"--idempotency-key",key]);
    expect(first.code).toBe(0);
    const { readFileSync, existsSync } = await import("node:fs");
    expect(JSON.parse(readFileSync(join(fixture.env.AGENTFLOW_OUTBOX_DIR,runId.toLowerCase(),"state.json"),"utf8"))).toMatchObject({runId:runId.toLowerCase(),allocatedThrough:0,acknowledgedThrough:0});
    expect(existsSync(join(fixture.env.AGENTFLOW_OUTBOX_DIR,`registration-${key}.json`))).toBe(false);
  } finally { await server.stop(); }
});

it("rejects unknown private arguments, token modes and service overlap without exposing input or mutating the destination", async () => {
  const { cliFixture } = await import("../fixtures/p06-cli");
  const { existsSync, chmodSync } = await import("node:fs");
  const server = await launch();
  const fixture = cliFixture(server);
  const secret = "PRIVATE-P06-ARGUMENT-SENTINEL";
  const file = fixture.file({name:secret});
  const args = ["project","create","--file",file,"--idempotency-key",randomUUID()];
  try {
    for (const overrides of [{ AGENTFLOW_OUTBOX_DIR: server.dir },{ AGENTFLOW_DATA_DIR: fixture.dir }]) {
      const result = await fixture.cli(args,overrides);
      expect(result.code).toBe(1);
      expect(result.stdout+result.stderr).not.toContain(secret);
      expect(result.stdout+result.stderr).not.toContain(server.dir);
    }
    const unknown = await fixture.cli([...args,"--"+secret,secret]);
    expect(unknown.code).toBe(1);
    expect(unknown.stdout+unknown.stderr).not.toContain(secret);
    chmodSync(fixture.env.AGENTFLOW_REPORTER_TOKEN_FILE,0o644);
    expect((await fixture.cli(args)).code).toBe(1);
    expect(existsSync(fixture.env.AGENTFLOW_OUTBOX_DIR)).toBe(false);
  } finally { await server.stop(); }
});

it("preserves exact whitespace and optional defaults across a committed registration with lost replies", async () => {
  const { createServer } = await import("node:http");
  const { readFileSync, readdirSync } = await import("node:fs");
  const { cliFixture } = await import("../fixtures/p06-cli");
  const { freePort } = await import("../fixtures/server");
  const server = await launch();
  const fixture = cliFixture(server);
  const port = await freePort();
  let lose = true;
  const proxy = createServer(async (req,res) => {
    const bytes: Buffer[] = [];
    for await (const chunk of req) bytes.push(Buffer.from(chunk));
    const response = await fetch(server.url + req.url, {method:req.method,headers:{Authorization:`Bearer ${server.credentials().reporterToken}`,"Content-Type":"application/json",...(req.headers["idempotency-key"] ? {"Idempotency-Key":String(req.headers["idempotency-key"])} : {})},body: req.method === "POST" ? Buffer.concat(bytes) : undefined});
    const body = await response.text();
    if (req.method === "POST" && lose) { res.destroy(); return; }
    res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(body);
  });
  await new Promise<void>(resolve => proxy.listen(port,"127.0.0.1",resolve));
  const original = {name:"  private registration  ",repositoryPath:"PRIVATE-P06-LOST-REPLY"};
  const file = fixture.file(original), key = randomUUID();
  const args = ["project","create","--file",file,"--idempotency-key",key];
  try {
    const queued = await fixture.cli(args,{PORT:String(port)});
    expect(queued.code).toBe(2);
    expect(queued.stdout+queued.stderr).not.toContain(original.repositoryPath);
    const preserved = JSON.parse(readFileSync(join(fixture.env.AGENTFLOW_OUTBOX_DIR,`registration-${key}.json`),"utf8"));
    expect(preserved.body).toEqual(original);
    writeFileSync(file,JSON.stringify({...original,name:original.name.trim()}));
    const conflict = await fixture.cli(args,{PORT:String(port)});
    expect(conflict.code).toBe(3);
    expect(JSON.parse(readFileSync(join(fixture.env.AGENTFLOW_OUTBOX_DIR,`registration-${key}.json`),"utf8"))).toEqual(preserved);
    writeFileSync(file,JSON.stringify(original)); lose = false;
    const replay = await fixture.cli(args,{PORT:String(port)});
    expect(replay.code).toBe(0);
    expect(Object.keys(JSON.parse(replay.stdout)).sort()).toEqual(["generation","id"]);
    expect(readdirSync(fixture.env.AGENTFLOW_OUTBOX_DIR).filter(name=>name.startsWith("registration-"))).toEqual([]);
    const db = new Database(join(server.dir,"agentflow.sqlite"),{readonly:true});
    try { expect(db.prepare("SELECT count(*) n FROM projects").get()).toEqual({n:1}); } finally {db.close();}
  } finally { await new Promise<void>(resolve=>proxy.close(()=>resolve())); await server.stop(); }
});
