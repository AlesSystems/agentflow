import Database from "better-sqlite3";
import { existsSync, lstatSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { z } from "zod";
import { uuid } from "../contracts/common";
import { canonicalDigest } from "../domain/request-digest";
import { activeAppRoot, createFile, privateDestination, secureDirectory, syncDirectory, validateFile } from "../server/filesystem";
import { runResponse } from "../contracts/observations";
import { settingsResponse } from "../contracts/responses";
import { CliError, readBounded, type CliConfig } from "./config";
import { request } from "./http";
const metadata = z.strictObject({ formatVersion: z.literal(1), port: z.number().int(), serviceDataDir: z.string(), generation: uuid, cursor: z.string().nullable() });
const registration = z.strictObject({ formatVersion: z.literal(1), key: uuid, path: z.enum(["/projects", "/tasks", "/agents", "/runs"]), body: z.record(z.string(), z.unknown()), digest: z.string().regex(/^[a-f0-9]{64}$/), order: z.number().int().nonnegative() });
export type Registration = z.infer<typeof registration>;
const overlaps = (a: string, b: string) => { const r = relative(a,b); return !r || (r !== ".." && !r.startsWith(".." + sep)); };
export async function openOutbox(config: CliConfig, end: number) {
  let association: z.infer<typeof metadata> | undefined;
  const metaPath = join(config.outbox, "metadata.json");
  if (existsSync(config.outbox)) {
    secureDirectory(config.outbox);
    if (existsSync(metaPath)) {
      validateFile(metaPath);
      association = metadata.parse(JSON.parse(readBounded(metaPath)));
      if (association.port !== config.port || config.explicitService && config.explicitService !== association.serviceDataDir) throw new CliError("destination_mismatch");
    }
  }
  const reply = await request(config, "/settings", settingsResponse, Math.min(end, performance.now() + 500));
  if (reply.kind === "delivered") {
    const serviceDataDir = privateDestination(reply.data.data.dataLocation, activeAppRoot());
    if (association && association.serviceDataDir !== serviceDataDir || config.explicitService && config.explicitService !== serviceDataDir) throw new CliError("destination_mismatch");
    association ||= { formatVersion: 1, port: config.port, serviceDataDir, generation: reply.generation, cursor: null };
  }
  if (!association) throw new CliError("destination_unavailable");
  if (overlaps(association.serviceDataDir, config.outbox) || overlaps(config.outbox, association.serviceDataDir)) throw new CliError("destination_overlap");
  const root = secureDirectory(config.outbox);
  const rootStat = lstatSync(root);
  const pin = () => { const stat = lstatSync(root); if (stat.dev !== rootStat.dev || stat.ino !== rootStat.ino || stat.isSymbolicLink()) throw new CliError("path_changed"); secureDirectory(root); };
  const locks: Database.Database[] = [];
  for (const name of ["publication.sqlite", "delivery.sqlite"]) {
    pin();
    const path = join(root, name);
    validateFile(path);
    if (!existsSync(path)) { try { createFile(path); syncDirectory(root); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } }
    validateFile(path);
    const lock = new Database(path); lock.pragma("busy_timeout = 0"); locks.push(lock);
  }
  const lockPins = locks.map((_, i) => lstatSync(join(root, i ? "delivery.sqlite" : "publication.sqlite")));
  function scan(directory = root): number {
    let bytes = 0;
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (lstatSync(path).isDirectory()) { secureDirectory(path); bytes += scan(path); }
      else { validateFile(path); bytes += lstatSync(path).size; }
    }
    return bytes;
  }
  function atomic(name: string, value: unknown) {
    pin();
    const encoded = JSON.stringify(value);
    if (scan() + Buffer.byteLength(encoded) > 100 * 1024 * 1024) throw new CliError("outbox_full");
    const path = join(root, name), temp = path + ".tmp";
    validateFile(path); validateFile(temp);
    if (existsSync(temp)) { unlinkSync(temp); syncDirectory(root); }
    createFile(temp, encoded); renameSync(temp, path); syncDirectory(name.includes("/") ? join(root,name.split("/")[0]) : root);
  }
  async function locked<T>(operation: () => T): Promise<T> {
    while (performance.now() < end) {
      pin();
      for (const [i, stat] of lockPins.entries()) { const current = lstatSync(join(root, i ? "delivery.sqlite" : "publication.sqlite")); if (current.dev !== stat.dev || current.ino !== stat.ino) throw new CliError("lock_changed"); }
      try { locks[0].exec("BEGIN EXCLUSIVE"); } catch { await new Promise(resolve => setTimeout(resolve, Math.min(20, Math.max(0,end-performance.now())))); continue; }
      try { return operation(); } finally { locks[0].exec("ROLLBACK"); }
    }
    throw new CliError("publication_busy");
  }
  const outbox = {
    async preserveRegistration(path: Registration["path"], key: string, body: Record<string, unknown>) {
      return locked(() => {
        const name = `registration-${key.toLowerCase()}.json`, file = join(root,name);
        const digest = canonicalDigest(body);
        if (existsSync(file)) {
          const old = registration.parse(JSON.parse(readBounded(file)));
          if (old.path !== path || old.digest !== digest) throw new CliError("registration_conflict", 3);
          return old;
        }
        const record: Registration = { formatVersion: 1, path, key, body, digest, order: Date.now() };
        atomic(name,record); return record;
      });
    },
    async initializeRun(id: string, until = end) {
      const reply = await request(config, `/runs/${id}`, runResponse, until);
      if (reply.kind !== "delivered") return reply;
      await locked(() => {
        const runId = reply.data.data.id;
        if (runId.toLowerCase() !== id.toLowerCase()) throw new CliError("run_identity_mismatch", 3);
        const path = join(root, id.toLowerCase(), "state.json");
        if (existsSync(path)) { validateFile(path); return; }
        if (reply.data.data.lastSequence !== 0) throw new CliError("producer_state_required", 3);
        secureDirectory(join(root,id.toLowerCase())); syncDirectory(root);
        atomic(`${id.toLowerCase()}/state.json`, {formatVersion:1,runId,allocatedThrough:0,acknowledgedThrough:0,generation:reply.generation});
      });
      return reply;
    },
    async removeRegistration(record: Registration) { return locked(() => { pin(); validateFile(join(root,`registration-${record.key.toLowerCase()}.json`)); unlinkSync(join(root,`registration-${record.key.toLowerCase()}.json`)); syncDirectory(root); }); },
    close() { for (const lock of locks) { if (lock.inTransaction) lock.exec("ROLLBACK"); lock.close(); } },
  };
  try { await locked(() => { if (!existsSync(metaPath)) atomic("metadata.json", association); }); return outbox; } catch (error) { outbox.close(); throw error; }
}
