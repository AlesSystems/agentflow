import Database from "better-sqlite3";
import { existsSync, lstatSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { uuid } from "../contracts/common";
import { eventInput, runResponse, agentCreate, runRegister, type EventInput } from "../contracts/observations";
import { canonicalDigest } from "../domain/request-digest";
import { activeAppRoot, createFile, privateDestination, secureDirectory, syncDirectory, validateFile } from "../server/filesystem";
import { projectCreate } from "../contracts/projects";
import { taskCreate } from "../contracts/tasks";
import { settingsResponse } from "../contracts/responses";
import { CliError, readBounded, type CliConfig } from "./config";
import { request } from "./http";
const GLOBAL_LIMIT = 100 * 1024 * 1024, RUN_LIMIT = 10 * 1024 * 1024, BOOTSTRAP = 65536;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const watermark = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const metadata = z.strictObject({ formatVersion: z.literal(1), port: z.number().int().min(1024).max(65535), serviceDataDir: z.string(), generation: uuid, cursor: z.string().nullable(), nextOrder: watermark.default(0) });
const registration = z.strictObject({ formatVersion: z.literal(1), key: uuid, path: z.enum(["/projects", "/tasks", "/agents", "/runs"]), body: z.record(z.string(), z.unknown()), digest, order: watermark });
const storedEvent = z.strictObject({ formatVersion: z.literal(1), body: z.record(z.string(),z.unknown()), digest });
const pending = z.strictObject({ record: storedEvent, filename: z.string(), remainingPeak: watermark });
const stateSchema = z.strictObject({ formatVersion: z.literal(1), runId: uuid, allocatedThrough: watermark, acknowledgedThrough: watermark, generation: uuid, pending: pending.optional() });
export type Registration = z.infer<typeof registration>;
export type EventRecord = z.infer<typeof storedEvent>;
type State = z.infer<typeof stateSchema>;
export type Job = { id: string; kind: "registration"; record: Registration } | { id: string; kind: "run"; runId: string };
const registrationInputs = {"/projects":projectCreate,"/tasks":taskCreate,"/agents":agentCreate,"/runs":runRegister};
const encodedBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const overlaps = (a: string, b: string) => { const r = relative(a,b); return !r || (r !== ".." && !r.startsWith(".." + sep)); };
const io = { createFile, renameSync, unlinkSync, syncDirectory };
export async function openOutbox(config: CliConfig, end: number, operations = io) {
  const root = config.outbox;
  const metaPath = join(root, "metadata.json");
  let association: z.infer<typeof metadata> | undefined;
  const read = (path: string, max = 65536) => { validateFile(path); return JSON.parse(readBounded(path,max)); };
  if (existsSync(root)) {
    secureDirectory(root);
    if (existsSync(metaPath)) {
      association = metadata.parse(read(metaPath));
      if (association.port !== config.port || config.explicitService && config.explicitService !== association.serviceDataDir) throw new CliError("destination_mismatch");
    }
  }
  const reply = await request(config, "/settings", settingsResponse, Math.min(end, performance.now() + 500));
  if (reply.kind === "delivered") {
    const serviceDataDir = privateDestination(reply.data.data.dataLocation, activeAppRoot());
    if (association && association.serviceDataDir !== serviceDataDir || config.explicitService && config.explicitService !== serviceDataDir) throw new CliError("destination_mismatch");
    association ||= { formatVersion: 1, port: config.port, serviceDataDir, generation: reply.generation, cursor: null, nextOrder:0 };
  }
  if (!association) throw new CliError("destination_unavailable");
  const service = privateDestination(association.serviceDataDir,activeAppRoot());
  if (overlaps(service,root) || overlaps(root,service)) throw new CliError("destination_overlap");
  secureDirectory(root);
  const identities = new Map<string, {dev:number;ino:number}>();
  function pin(directory: string) {
    if (identities.has(directory) && !existsSync(directory)) throw new CliError("path_changed");
    secureDirectory(directory);
    const stat = lstatSync(directory), old = identities.get(directory);
    if ((stat.mode & 0o777) !== 0o700) throw new CliError("unsafe_outbox_permissions");
    if (old && (stat.dev !== old.dev || stat.ino !== old.ino)) throw new CliError("path_changed");
    identities.set(directory,stat);
  }
  pin(root);
  const lockPaths = [join(root,"publication.sqlite"),join(root,"delivery.sqlite")];
  function lengths(directory = root, runId?: string): {global:number;run:number} {
    pin(directory);
    let global = 0, run = 0;
    for (const name of readdirSync(directory)) {
      if (performance.now() >= end) throw new CliError("accounting_deadline");
      const path = join(directory,name), stat = lstatSync(path);
      if (stat.isDirectory()) {
        if (directory !== root || !uuid.safeParse(name).success || name !== name.toLowerCase()) throw new CliError("unexpected_outbox_entry");
        const child = lengths(path,runId); global += child.global; run += name === runId ? child.global : 0;
      } else {
        validateFile(path);
        if ((stat.mode & 0o777) !== 0o600) throw new CliError("unsafe_outbox_permissions");
        if (directory === root ? !/^(metadata\.json(?:\.tmp)?|registration-[a-f0-9-]{36}\.json(?:\.tmp)?|(?:publication|delivery)\.sqlite(?:-journal|-wal|-shm)?)$/.test(name) : !/^(state\.json(?:\.tmp)?|[1-9][0-9]*-[a-f0-9-]{36}\.json(?:\.tmp)?)$/.test(name)) throw new CliError("unexpected_outbox_entry");
        if (directory === root && name.startsWith("registration-") && !name.endsWith(".tmp")) {
          const record = registration.parse(read(path,100000));
          if (record.key.toLowerCase() !== name.slice(13,-5) || !registrationInputs[record.path].safeParse(record.body).success || canonicalDigest(record.body) !== record.digest) throw new CliError("corrupt_registration",3);
          if (record.path === "/runs" && String(record.body.id).toLowerCase() === runId) run += stat.size;
        }
        global += stat.size;
      }
    }
    return {global,run};
  }
  const locks: Database.Database[] = [];
  try {
    if (!lockPaths.every(existsSync) && lengths().global + BOOTSTRAP > GLOBAL_LIMIT) throw new CliError("bootstrap_full");
    for (const path of lockPaths) {
      pin(root); validateFile(path);
      if (!existsSync(path)) { try { operations.createFile(path); operations.syncDirectory(root); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } }
      validateFile(path);
      const lock = new Database(path); locks.push(lock); lock.pragma("busy_timeout = 0");
    }
    const bootstrapBytes = readdirSync(root).filter(name=>/^(publication|delivery)\.sqlite(?:-journal|-wal|-shm)?$/.test(name)).reduce((sum,name)=>sum+lstatSync(join(root,name)).size,0);
    if (bootstrapBytes > BOOTSTRAP) throw new CliError("bootstrap_oversize");
  } catch (error) { for (const lock of locks) lock.close(); throw error; }
  const lockPins = lockPaths.map(path=>lstatSync(path));
  function assertPins() {
    pin(root);
    for (const [i,path] of lockPaths.entries()) {
      validateFile(path); const current = lstatSync(path);
      if (current.dev !== lockPins[i].dev || current.ino !== lockPins[i].ino) throw new CliError("lock_changed");
    }
  }
  function state(id: string): State {
    const value = stateSchema.parse(read(join(root,id.toLowerCase(),"state.json"),200000));
    if (value.runId.toLowerCase() !== id.toLowerCase() || value.acknowledgedThrough > value.allocatedThrough) throw new CliError("corrupt_state",3);
    return value;
  }
  function validateRecord(record: EventRecord, id: string, sequence: number) {
    const parsed = eventInput.safeParse(record.body);
    if (!parsed.success || canonicalDigest(record.body) !== record.digest || parsed.data.runId !== id.toLowerCase() || parsed.data.sequence !== sequence || encodedBytes(record.body) > 65536) throw new CliError("corrupt_record",3);
    return parsed.data;
  }
  function reservations(runId?: string) {
    let global = 0, run = 0;
    for (const name of readdirSync(root)) {
      if (!lstatSync(join(root,name)).isDirectory() || !existsSync(join(root,name,"state.json"))) continue;
      const value = state(name);
      if (value.pending) {
        const p = value.pending;
        validateRecord(p.record,name,value.allocatedThrough);
        const expected = `${value.allocatedThrough}-${String(p.record.body.eventId).toLowerCase()}.json`;
        const clean = {...value}; delete clean.pending;
        if (p.filename !== expected || p.remainingPeak !== encodedBytes(p.record)+encodedBytes(clean)) throw new CliError("corrupt_reservation",3);
        const existing = existsSync(join(root,name,p.filename)) ? lstatSync(join(root,name,p.filename)).size : 0;
        const remaining = Math.max(0,p.remainingPeak-existing);
        global += remaining; if (name === runId) run += remaining;
      }
    }
    return {global,run};
  }
  function admit(additional: number, runId?: string) {
    assertPins(); const actual = lengths(root,runId), reserved = reservations(runId);
    if (actual.global+reserved.global+additional > GLOBAL_LIMIT || runId && actual.run+reserved.run+additional > RUN_LIMIT) throw new CliError("outbox_full");
  }
  function atomic(name: string,value: unknown, recovering = false) {
    assertPins(); const path = join(root,name), parent = dirname(path); pin(parent);
    const encoded = JSON.stringify(value);
    if (!recovering) admit(Buffer.byteLength(encoded), name.includes("/") ? name.split("/")[0] : name.startsWith("registration-") && typeof value === "object" && value !== null && "path" in value && value.path === "/runs" ? String((value as Registration).body.id).toLowerCase() : undefined);
    const temp = path+".tmp";
    validateFile(path); validateFile(temp);
    if (existsSync(temp)) { operations.unlinkSync(temp); operations.syncDirectory(parent); }
    operations.createFile(temp,encoded); operations.renameSync(temp,path); operations.syncDirectory(parent);
  }
  function remove(path: string) { assertPins(); pin(dirname(path)); validateFile(path); operations.unlinkSync(path); operations.syncDirectory(dirname(path)); }
  function recover() {
    lengths(); reservations();
    for (const name of readdirSync(root)) {
      const directory = join(root,name);
      if (!lstatSync(directory).isDirectory()) {
        if (name.endsWith(".tmp")) remove(directory);
        continue;
      }
      pin(directory);
      const statePath = join(directory,"state.json");
      if (!existsSync(statePath)) {
        for (const file of readdirSync(directory)) {
          if (file === "state.json.tmp") remove(join(directory,file)); else throw new CliError("producer_state_required",3);
        }
        continue;
      }
      const value = state(name);
      if (value.pending) {
        const p = value.pending, target = join(directory,p.filename);
        if (existsSync(target)) {
          const current = storedEvent.parse(read(target,100000));
          if (canonicalDigest(current) !== canonicalDigest(p.record)) throw new CliError("corrupt_record",3);
        } else atomic(`${name}/${p.filename}`,p.record,true);
        const clean = {...value}; delete clean.pending;
        atomic(`${name}/state.json`,clean,true);
      }
      const current = state(name);
      const sequences = new Set<number>();
      for (const file of readdirSync(directory)) {
        if (file === "state.json") continue;
        if (file.endsWith(".tmp")) { remove(join(directory,file)); continue; }
        const match = /^([1-9][0-9]*)-([a-f0-9-]{36})\.json$/.exec(file);
        if (!match) throw new CliError("unexpected_outbox_entry",3);
        const seq = Number(match[1]), record = storedEvent.parse(read(join(directory,file),100000));
        const parsed = validateRecord(record,name,seq);
        if (parsed.eventId !== match[2] || seq > current.allocatedThrough || sequences.has(seq)) throw new CliError("corrupt_record",3);
        if (seq <= current.acknowledgedThrough) { remove(join(directory,file)); continue; }
        sequences.add(seq);
      }
      if (sequences.size !== current.allocatedThrough-current.acknowledgedThrough) throw new CliError("missing_sequence",3);
    }
    lengths();
  }
  async function locked<T>(operation: () => T): Promise<T> {
    while (performance.now() < end) {
      assertPins();
      try { locks[0].exec("BEGIN EXCLUSIVE"); } catch { await new Promise(resolve => setTimeout(resolve,Math.min(20,Math.max(0,end-performance.now())))); continue; }
      try { recover(); return operation(); } finally { locks[0].exec("ROLLBACK"); }
    }
    throw new CliError("publication_busy");
  }
  const outbox = {
    async preserveRegistration(path: Registration["path"],key: string,body: Record<string,unknown>) {
      return locked(()=> {
        const name = `registration-${key.toLowerCase()}.json`, file = join(root,name), bodyDigest = canonicalDigest(body);
        if (existsSync(file)) {
          const old = registration.parse(read(file,100000));
          if (canonicalDigest(old.body) !== old.digest) throw new CliError("corrupt_registration",3);
          if (old.path !== path || old.digest !== bodyDigest) throw new CliError("registration_conflict",3);
          return old;
        }
        const meta = metadata.parse(read(metaPath));
        if (meta.nextOrder === Number.MAX_SAFE_INTEGER) throw new CliError("order_exhausted");
        const record: Registration = {formatVersion:1,path,key,body,digest:bodyDigest,order:meta.nextOrder};
        admit(encodedBytes(record)+encodedBytes({...meta,nextOrder:meta.nextOrder+1}),path === "/runs" ? String(body.id).toLowerCase() : undefined);
        atomic("metadata.json",{...meta,nextOrder:meta.nextOrder+1}); atomic(name,record); return record;
      });
    },
    async initializeRun(id: string,until = end) {
      const reply = await request(config,`/runs/${id}`,runResponse,until);
      if (reply.kind !== "delivered") return reply;
      await locked(()=> {
        const runId = reply.data.data.id;
        if (runId.toLowerCase() !== id.toLowerCase()) throw new CliError("run_identity_mismatch",3);
        const path = join(root,id.toLowerCase(),"state.json");
        if (existsSync(path)) {
          const old = state(id);
          if (reply.data.data.lastSequence < old.acknowledgedThrough || reply.data.data.lastSequence > old.allocatedThrough) throw new CliError("remote_prefix_mismatch",3);
          return;
        }
        if (reply.data.data.lastSequence !== 0) throw new CliError("producer_state_required",3);
        const value: State = {formatVersion:1,runId,allocatedThrough:0,acknowledgedThrough:0,generation:reply.generation};
        admit(encodedBytes(value),id.toLowerCase()); secureDirectory(join(root,id.toLowerCase())); pin(join(root,id.toLowerCase())); operations.syncDirectory(root);
        atomic(`${id.toLowerCase()}/state.json`,value);
      });
      return reply;
    },
    async tracked(id: string) {return locked(()=>existsSync(join(root,id.toLowerCase(),"state.json")));},
    async enqueue(id: string,type: string,payload: Record<string,unknown>) {
      return locked(()=> {
        const previous = state(id);
        if (previous.allocatedThrough === Number.MAX_SAFE_INTEGER) throw new CliError("sequence_exhausted");
        const body = {schemaVersion:1,eventId:randomUUID(),runId:id,sequence:previous.allocatedThrough+1,type,occurredAt:new Date().toISOString(),payload};
        if (!eventInput.safeParse(body).success || encodedBytes(body)>65536) throw new CliError("invalid_input");
        const record: EventRecord = {formatVersion:1,body,digest:canonicalDigest(body)};
        const clean: State = {...previous,allocatedThrough:body.sequence};
        const filename = `${body.sequence}-${body.eventId}.json`;
        const descriptor: State = {...clean,pending:{record,filename,remainingPeak:encodedBytes(record)+encodedBytes(clean)}};
        admit(encodedBytes(descriptor)+encodedBytes(record)+encodedBytes(clean),id.toLowerCase());
        atomic(`${id.toLowerCase()}/state.json`,descriptor,true);
        atomic(`${id.toLowerCase()}/${filename}`,record,true);
        atomic(`${id.toLowerCase()}/state.json`,clean,true);
        return record;
      });
    },
    async next(id: string) {return locked(()=> {
      const value = state(id);
      if (value.acknowledgedThrough === value.allocatedThrough) return undefined;
      const file = readdirSync(join(root,id.toLowerCase())).find(name=>name.startsWith(`${value.acknowledgedThrough+1}-`));
      if (!file) throw new CliError("missing_sequence",3);
      return storedEvent.parse(read(join(root,id.toLowerCase(),file),100000));
    });},
    async acknowledge(record: EventRecord,generation: string) {return locked(()=> {
      const event = record.body as unknown as EventInput, value = state(event.runId);
      if (value.acknowledgedThrough+1 !== event.sequence) throw new CliError("ack_sequence_mismatch",3);
      atomic(`${event.runId.toLowerCase()}/state.json`,{...value,acknowledgedThrough:event.sequence,generation});
      remove(join(root,event.runId.toLowerCase(),`${event.sequence}-${event.eventId.toLowerCase()}.json`));
    });},
    async validateRemote(id: string,generation: string,until: number) {
      const local = await locked(()=>state(id));
      if (local.generation === generation) return {kind:"delivered" as const};
      const current = await outbox.initializeRun(id,until);
      if (current.kind === "delivered") await locked(()=>atomic(`${id.toLowerCase()}/state.json`,{...state(id),generation:current.generation}));
      return current;
    },
    async jobs() {return locked(()=> {
      const jobs: Job[] = [];
      for (const name of readdirSync(root)) {
        if (name.startsWith("registration-") && name.endsWith(".json")) {
          const record = registration.parse(read(join(root,name),100000));
          if (record.digest !== canonicalDigest(record.body)) throw new CliError("corrupt_registration",3);
          jobs.push({id:`registration:${String(record.order).padStart(16,"0")}:${record.key.toLowerCase()}`,kind:"registration",record});
        } else if (lstatSync(join(root,name)).isDirectory() && existsSync(join(root,name,"state.json"))) {
          const value = state(name);
          if (value.acknowledgedThrough < value.allocatedThrough) jobs.push({id:`run:${name}`,kind:"run",runId:name});
        }
      }
      return jobs.sort((a,b)=>a.id.localeCompare(b.id));
    });},
    async cursor() {return locked(()=>metadata.parse(read(metaPath)).cursor);},
    async advanceCursor(id: string) {return locked(()=>atomic("metadata.json",{...metadata.parse(read(metaPath)),cursor:id}));},
    async removeRegistration(record: Registration) {return locked(()=>remove(join(root,`registration-${record.key.toLowerCase()}.json`)));},
    acquireDelivery() {assertPins(); try {locks[1].exec("BEGIN EXCLUSIVE"); return true;} catch {return false;}},
    close() {for (const lock of locks) {if (lock.inTransaction) lock.exec("ROLLBACK"); lock.close();}},
  };
  try {await locked(()=>{if (!existsSync(metaPath)) atomic("metadata.json",association);}); return outbox;} catch (error) {outbox.close();throw error;}
}
export type Outbox = Awaited<ReturnType<typeof openOutbox>>;
