import Database from "better-sqlite3";
import { existsSync, lstatSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { uuid } from "../contracts/common";
import { eventInput, runResponse, agentCreate, runRegister, type EventInput } from "../contracts/observations";
import { canonicalDigest } from "../domain/request-digest";
import { activeAppRoot, createFile, privateDestination, secureDirectory, syncDirectory, syncFile, validateFile } from "../server/filesystem";
import { projectCreate } from "../contracts/projects";
import { taskCreate } from "../contracts/tasks";
import { settingsResponse } from "../contracts/responses";
import { CliError, readBounded, readBoundedBytes, type CliConfig } from "./config";
import { request } from "./http";
const GLOBAL_LIMIT = 100 * 1024 * 1024, RUN_LIMIT = 10 * 1024 * 1024, BOOTSTRAP = 65536;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const watermark = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const registration = z.strictObject({ formatVersion: z.literal(1), path: z.enum(["/projects", "/tasks", "/agents", "/runs"]), key: uuid, body: z.record(z.string(), z.unknown()), digest, order: watermark });
const cursorIdentity=z.string().regex(/^(?:run:|registration:[0-9]{16}:)[a-f0-9-]{36}$/).refine(value=>uuid.safeParse(value.split(":").at(-1)).success&&(!value.startsWith("registration:")||Number.isSafeInteger(Number(value.split(":")[1]))));
const metadata = z.strictObject({ formatVersion: z.literal(1), port: z.number().int().min(1024).max(65535), serviceDataDir: z.string(), generation: uuid, cursor: cursorIdentity.nullable(), nextOrder: watermark.default(0), pendingRegistration: z.strictObject({record:registration,filename:z.string(),remainingPeak:watermark}).optional() });
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
const io = { createFile, renameSync, unlinkSync, syncDirectory, syncFile };
export async function openOutbox(config: CliConfig, end: number, operations: Partial<typeof io> = {}) {
  const filesystem={...io,...operations};
  let budget=end;
  const root = config.outbox;
  const metaPath = join(root, "metadata.json");
  let association: z.infer<typeof metadata> | undefined;
  const read = (path: string, max = 65536) => { validateFile(path); return JSON.parse(readBounded(path,max)); };
  function parseRetained<S extends z.ZodType>(schema: S,path: string,max: number,code: string): z.infer<S> {
    validateFile(path);
    try{return schema.parse(read(path,max));}
    catch(error){if(error instanceof SyntaxError || error instanceof z.ZodError || (error as NodeJS.ErrnoException).code==="ERR_ENCODING_INVALID_ENCODED_DATA")throw new CliError(code,3);throw error;}
  }
  const readMetadata=()=>parseRetained(metadata,metaPath,200000,"corrupt_metadata");
  if (existsSync(root)) {
    secureDirectory(root);
    if (existsSync(metaPath)) {
      association = readMetadata();
      if (association.port !== config.port || config.explicitService && config.explicitService !== association.serviceDataDir) throw new CliError("destination_mismatch");
    } else if(readdirSync(root).some(name=>name.startsWith("registration-") || uuid.safeParse(name).success)) {
      throw new CliError("destination_association_required",3);
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
      if (performance.now() >= budget) throw new CliError("accounting_deadline");
      const path = join(directory,name), stat = lstatSync(path);
      if (stat.isDirectory()) {
        if (directory !== root || !uuid.safeParse(name).success || name !== name.toLowerCase()) throw new CliError("unexpected_outbox_entry");
        const child = lengths(path,runId); global += child.global; run += name === runId ? child.global : 0;
      } else {
        validateFile(path);
        if ((stat.mode & 0o777) !== 0o600) throw new CliError("unsafe_outbox_permissions");
        if (directory === root ? !/^(metadata\.json(?:\.tmp)?|registration-[a-f0-9-]{36}\.json(?:\.tmp)?|(?:publication|delivery)\.sqlite(?:-journal|-wal|-shm)?)$/.test(name) : !/^(state\.json(?:\.tmp)?|[1-9][0-9]*-[a-f0-9-]{36}\.json(?:\.tmp)?)$/.test(name)) throw new CliError("unexpected_outbox_entry");
        if (directory === root && name.startsWith("registration-")) {
          const finalName = name.replace(/\.tmp$/,""), finalPath = join(root,finalName);
          const descriptor = existsSync(metaPath) ? readMetadata().pendingRegistration : undefined;
          const record = name.endsWith(".tmp") && descriptor?.filename === finalName ? descriptor.record : name.endsWith(".tmp") && existsSync(finalPath) ? readRegistration(finalPath,finalName) : readRegistration(path,finalName);
          validateRegistration(record,finalName);
          if (name.endsWith(".tmp")) validateTemporary(path,record,100000);
          if (record.path === "/runs" && String(record.body.id).toLowerCase() === runId) run += stat.size;
        }
        global += stat.size;
      }
    }
    return {global,run};
  }
  const bootstrapPins = new Map<string,{dev:number;ino:number;size:number}>();
  function inspectLockArtifacts(bootstrapOwned=false) {
    pin(root);
    let bytes = 0;
    for (const name of readdirSync(root)) {
      if (!/^(publication|delivery)\.sqlite/.test(name)) continue;
      const path = join(root,name);
      validateFile(path);
      const stat = lstatSync(path);
      if ((stat.mode & 0o777) !== 0o600) throw new CliError("unsafe_outbox_permissions");
      if (!lockPaths.includes(path)) throw new CliError("unexpected_lock_sidecar");
      const original = bootstrapPins.get(path);
      if(original&&(stat.dev!==original.dev||stat.ino!==original.ino||stat.size!==original.size&&!(bootstrapOwned&&locks[0]?.inTransaction&&original.size===0&&stat.size===4096)))throw new CliError("lock_changed");
      bootstrapPins.set(path,stat);
      bytes += stat.size;
    }
    if (bytes > BOOTSTRAP) throw new CliError("bootstrap_oversize");
  }
  function bootstrapRoom() {
    const actual=lengths().global,reserved=reservations().global;
    const owned=readdirSync(root).filter(name=>/^(publication|delivery)\.sqlite(?:-journal|-wal|-shm)?$/.test(name)).reduce((sum,name)=>sum+lstatSync(join(root,name)).size,0);
    if(owned>BOOTSTRAP)throw new CliError("bootstrap_oversize");
    if(actual+reserved+Math.max(0,BOOTSTRAP-owned)>GLOBAL_LIMIT)throw new CliError("bootstrap_full");
  }
  const locks: Database.Database[] = [];
  try {
    inspectLockArtifacts();
    const bootstrapLengths = lengths();
    const allowance = lockPaths.every(path=>existsSync(path) && lstatSync(path).size > 0) ? 0 : BOOTSTRAP;
    if (bootstrapLengths.global + reservations().global + allowance > GLOBAL_LIMIT) throw new CliError("bootstrap_full");
    for (const path of lockPaths) {
      inspectLockArtifacts();
      if (!existsSync(path)) {
        try { filesystem.createFile(path); filesystem.syncDirectory(root); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      }
      inspectLockArtifacts();
    }
    let publication: Database.Database|undefined;
    while(performance.now()<end) {
      inspectLockArtifacts();const candidate=new Database(lockPaths[0]);candidate.pragma("busy_timeout=0");
      try{candidate.exec("BEGIN EXCLUSIVE");publication=candidate;locks.push(candidate);break;}
      catch(error){candidate.close();if(!["SQLITE_BUSY","SQLITE_LOCKED"].includes((error as {code:string}).code))throw error;await new Promise(resolve=>setTimeout(resolve,Math.min(10+Math.random()*25,Math.max(0,end-performance.now()))));}
    }
    if(!publication)throw new CliError("bootstrap_busy");
    const publicationBefore=lstatSync(lockPaths[0]),publicationPin=bootstrapPins.get(lockPaths[0])!;
    if(publicationBefore.dev!==publicationPin.dev||publicationBefore.ino!==publicationPin.ino)throw new CliError("lock_changed");
    if(publicationBefore.size===0){
      bootstrapRoom();
      publication.pragma("user_version=0");publication.exec("COMMIT");
      const initialized=lstatSync(lockPaths[0]);
      if(initialized.dev!==publicationPin.dev||initialized.ino!==publicationPin.ino||initialized.size!==4096)throw new CliError("lock_changed");
      filesystem.syncFile(lockPaths[0]);filesystem.syncDirectory(root);bootstrapPins.set(lockPaths[0],initialized);
      try{publication.exec("BEGIN EXCLUSIVE");}catch{throw new CliError("bootstrap_busy");}
    }else if(publicationBefore.size!==4096||publication.pragma("user_version",{simple:true})!==0)throw new CliError("lock_changed");
    inspectLockArtifacts(true);
    if(lstatSync(lockPaths[1]).size===0)bootstrapRoom();else if(lengths().global+reservations().global>GLOBAL_LIMIT)throw new CliError("bootstrap_full");
    const delivery=new Database(lockPaths[1]);locks.push(delivery);delivery.pragma("busy_timeout=0");
    const deliveryBefore=lstatSync(lockPaths[1]),deliveryPin=bootstrapPins.get(lockPaths[1])!;
    if(deliveryBefore.dev!==deliveryPin.dev||deliveryBefore.ino!==deliveryPin.ino)throw new CliError("lock_changed");
    if(deliveryBefore.size===0)delivery.pragma("user_version=0");
    const initializedDelivery=lstatSync(lockPaths[1]);
    const deliveryHeader=readBoundedBytes(lockPaths[1],4096);
    if(initializedDelivery.dev!==deliveryPin.dev||initializedDelivery.ino!==deliveryPin.ino||initializedDelivery.size!==4096||deliveryHeader.subarray(0,16).toString("binary")!=="SQLite format 3\0"||deliveryHeader.readUInt32BE(60)!==0)throw new CliError("lock_changed");
    filesystem.syncFile(lockPaths[1]);filesystem.syncDirectory(root);bootstrapPins.set(lockPaths[1],initializedDelivery);
    inspectLockArtifacts();publication.exec("ROLLBACK");
  } catch (error) {for(const lock of locks){if(lock.inTransaction)lock.exec("ROLLBACK");lock.close();}throw error;}
  const lockPins = lockPaths.map(path=>lstatSync(path));
  function assertPins() {
    inspectLockArtifacts();
    for (const [i,path] of lockPaths.entries()) {
      validateFile(path); const current = lstatSync(path);
      if (current.dev !== lockPins[i].dev || current.ino !== lockPins[i].ino) throw new CliError("lock_changed");
    }
  }
  function state(id: string): State {
    const value=parseRetained(stateSchema,join(root,id.toLowerCase(),"state.json"),200000,"corrupt_state");
    if(value.runId.toLowerCase()!==id.toLowerCase() || value.acknowledgedThrough>value.allocatedThrough)throw new CliError("corrupt_state",3);
    return value;
  }
  function validateRecord(record: EventRecord, id: string, sequence: number) {
    const parsed = eventInput.safeParse(record.body);
    if (!parsed.success || canonicalDigest(record.body) !== record.digest || parsed.data.runId !== id.toLowerCase() || parsed.data.sequence !== sequence || encodedBytes(record.body) > 65536) throw new CliError("corrupt_record",3);
    return parsed.data;
  }
  function validateRegistration(record: Registration,filename: string) {
    if (filename !== `registration-${record.key.toLowerCase()}.json` || !registrationInputs[record.path].safeParse(record.body).success || canonicalDigest(record.body) !== record.digest) throw new CliError("corrupt_registration",3);
  }
  function readRegistration(path: string,filename: string): Registration {
    const record=parseRetained(registration,path,100000,"corrupt_registration");validateRegistration(record,filename);return record;
  }
  function validateTemporary(path: string,value: unknown,max = 200000) {
    const expected=Buffer.from(JSON.stringify(value)),actual=readBoundedBytes(path,max);
    if(actual.length>expected.length || !expected.subarray(0,actual.length).equals(actual))throw new CliError("corrupt_temporary",3);
    return actual.length;
  }
  function abandoned<T>(path: string,schema: z.ZodType<T>,prefix: string,validate: (value:T)=>void) {
    validateFile(path);const bytes=readBoundedBytes(path,200000),header=Buffer.from(prefix);
    if(!header.subarray(0,bytes.length).equals(bytes) && !bytes.subarray(0,header.length).equals(header))throw new CliError("corrupt_temporary",3);
    let raw: unknown;
    try{raw=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
    catch(error){
      const position=error instanceof SyntaxError?/at position ([0-9]+)/.exec(error.message):null;
      if((error as NodeJS.ErrnoException).code==="ERR_ENCODING_INVALID_ENCODED_DATA") {
        for(let width=1;width<=3&&width<=bytes.length;width++) {
          const tail=bytes.subarray(bytes.length-width),lead=tail[0],required=lead>=0xc2&&lead<=0xdf?2:lead>=0xe0&&lead<=0xef?3:lead>=0xf0&&lead<=0xf4?4:0;
          if(!required||width>=required||!tail.subarray(1).every(byte=>byte>=0x80&&byte<=0xbf)||width>1&&(lead===0xe0&&tail[1]<0xa0||lead===0xed&&tail[1]>0x9f||lead===0xf0&&tail[1]<0x90||lead===0xf4&&tail[1]>0x8f))continue;
          try {
            const decoded=new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(0,bytes.length-width));
            // A split scalar can only continue ordinary JSON string content.
            // Native parsing rejects an earlier invalid token; lexical context
            // excludes completed values and unfinished escapes at the EOF.
            let incomplete=false;
            try{JSON.parse(decoded);}catch(parseError){
              const at=parseError instanceof SyntaxError?/at position ([0-9]+)/.exec(parseError.message):null;
              incomplete=parseError instanceof SyntaxError&&(parseError.message==="Unexpected end of JSON input"||parseError.message.startsWith("Unterminated string")||Boolean(at&&Number(at[1])===decoded.length));
            }
            let string=false,escape=false,unicode=0,valid=true;
            for(const char of decoded) {
              if(!string){if(char==='"')string=true;continue;}
              if(unicode){if(!/[0-9a-fA-F]/.test(char)){valid=false;break;}unicode--;continue;}
              if(escape){escape=false;if(char==="u")unicode=4;else if(!'"\\/bfnrt'.includes(char)){valid=false;break;}continue;}
              if(char==='"')string=false;else if(char==="\\")escape=true;else if(char.charCodeAt(0)<32){valid=false;break;}
            }
            if(incomplete&&valid&&string&&!escape&&!unicode)return;
          }catch{}
        }
      }
      if(error instanceof SyntaxError && (error.message==="Unexpected end of JSON input" || error.message.startsWith("Unterminated string") || position&&Number(position[1])===bytes.toString("utf8").length))return;
      throw new CliError("corrupt_temporary",3);
    }
    const parsed=schema.safeParse(raw);if(!parsed.success)throw new CliError("corrupt_temporary",3);validate(parsed.data);
  }
  function abandonedMetadata(path: string) {
    const reference=existsSync(metaPath)?readMetadata():association!;
    const prefix=JSON.stringify({formatVersion:1,port:reference.port,serviceDataDir:reference.serviceDataDir,generation:reference.generation}).slice(0,-1);
    abandoned(path,metadata,prefix,value=> {
      if(value.port!==reference.port || value.serviceDataDir!==reference.serviceDataDir || value.generation!==reference.generation || value.nextOrder<reference.nextOrder || value.nextOrder>reference.nextOrder+1)throw new CliError("corrupt_temporary",3);
      if(value.pendingRegistration){const p=value.pendingRegistration,clean={...value};delete clean.pendingRegistration;validateRegistration(p.record,p.filename);if(p.record.order+1!==value.nextOrder||p.remainingPeak!==encodedBytes(p.record)+encodedBytes(clean))throw new CliError("corrupt_temporary",3);}
    });
  }
  function abandonedState(path: string,id: string,reference?: State) {
    const bytes=readBoundedBytes(path,200000),prefix=JSON.stringify({formatVersion:1,runId:reference?.runId||id}).slice(0,-1);
    const lower=Buffer.from(bytes.toString("utf8").toLowerCase()),header=Buffer.from(prefix.toLowerCase());
    if(!header.subarray(0,lower.length).equals(lower)&&!lower.subarray(0,header.length).equals(header))throw new CliError("corrupt_temporary",3);
    const exactPrefix=bytes.subarray(0,Math.min(bytes.length,Buffer.byteLength(prefix))).toString("utf8");
    abandoned(path,stateSchema,exactPrefix,value=> {
      const allocated=reference?.allocatedThrough||0,acknowledged=reference?.acknowledgedThrough||0;
      if(value.runId.toLowerCase()!==id.toLowerCase() || value.allocatedThrough<allocated || value.allocatedThrough>allocated+1 || value.acknowledgedThrough<acknowledged || value.acknowledgedThrough>acknowledged+1 || value.acknowledgedThrough>value.allocatedThrough)throw new CliError("corrupt_temporary",3);
      if(value.pending){const p=value.pending,clean={...value};delete clean.pending;validateRecord(p.record,id,value.allocatedThrough);if(p.filename!==`${value.allocatedThrough}-${String(p.record.body.eventId).toLowerCase()}.json`||p.remainingPeak!==encodedBytes(p.record)+encodedBytes(clean))throw new CliError("corrupt_temporary",3);}
    });
  }
  function remaining(final: string,value: unknown,max = 200000) {
    const bytes=encodedBytes(value), temp=final+".tmp";
    const temporary=existsSync(temp)?validateTemporary(temp,value,max):0;
    if (existsSync(final)) {
      if (readBounded(final,max)!==JSON.stringify(value)) throw new CliError("corrupt_record",3);
      return 0;
    }
    return bytes-temporary;
  }
  function reservations(runId?: string) {
    let global=0,run=0;
    if (existsSync(metaPath)) {
      const meta=readMetadata(),p=meta.pendingRegistration;
      if (p) {
        validateRegistration(p.record,p.filename);
        const clean={...meta};delete clean.pendingRegistration;
        if (p.record.order+1 !== meta.nextOrder || p.remainingPeak !== encodedBytes(p.record)+encodedBytes(clean)) throw new CliError("corrupt_reservation",3);
        const journal=remaining(join(root,p.filename),p.record,100000);
        const replacement=existsSync(metaPath+".tmp")?Math.max(0,encodedBytes(clean)-validateTemporary(metaPath+".tmp",clean)):encodedBytes(clean);
        global+=journal+replacement;
        if (p.record.path === "/runs" && String(p.record.body.id).toLowerCase()===runId)run+=journal;
      }
    }
    for (const name of readdirSync(root)) {
      if (!lstatSync(join(root,name)).isDirectory() || !existsSync(join(root,name,"state.json")))continue;
      const value=state(name),p=value.pending;
      if (!p)continue;
      validateRecord(p.record,name,value.allocatedThrough);
      const expected=`${value.allocatedThrough}-${String(p.record.body.eventId).toLowerCase()}.json`,clean={...value};delete clean.pending;
      if (p.filename!==expected || p.remainingPeak!==encodedBytes(p.record)+encodedBytes(clean))throw new CliError("corrupt_reservation",3);
      const record=remaining(join(root,name,p.filename),p.record,100000);
      const temp=join(root,name,"state.json.tmp");
      const replacement=existsSync(temp)?Math.max(0,encodedBytes(clean)-validateTemporary(temp,clean)):encodedBytes(clean);
      global+=record+replacement;if(name===runId)run+=record+replacement;
    }
    return {global,run};
  }
  function admit(additional: number,runId?: string,runAdditional=additional) {
    assertPins();const actual=lengths(root,runId),reserved=reservations(runId);
    if(actual.global+reserved.global+additional>GLOBAL_LIMIT || runId && actual.run+reserved.run+runAdditional>RUN_LIMIT)throw new CliError("outbox_full");
  }
  function atomic(name: string,value: unknown, recovering = false) {
    assertPins(); const path = join(root,name), parent = dirname(path); pin(parent);
    const encoded = JSON.stringify(value);
    if (!recovering) admit(Buffer.byteLength(encoded), name.includes("/") ? name.split("/")[0] : name.startsWith("registration-") && typeof value === "object" && value !== null && "path" in value && value.path === "/runs" ? String((value as Registration).body.id).toLowerCase() : undefined);
    const temp = path+".tmp";
    validateFile(path); validateFile(temp);
    if (existsSync(temp)) { filesystem.unlinkSync(temp); filesystem.syncDirectory(parent); }
    assertPins();pin(parent);filesystem.createFile(temp,encoded);
    assertPins();pin(parent);validateFile(temp);filesystem.renameSync(temp,path);
    assertPins();pin(parent);filesystem.syncDirectory(parent);
  }
  function remove(path: string) {assertPins();pin(dirname(path));validateFile(path);filesystem.unlinkSync(path);assertPins();pin(dirname(path));filesystem.syncDirectory(dirname(path));}
  function recover() {
    lengths(); reservations();
    if(existsSync(metaPath+".tmp") && (!existsSync(metaPath)||!readMetadata().pendingRegistration))abandonedMetadata(metaPath+".tmp");
    for(const name of readdirSync(root))if(lstatSync(join(root,name)).isDirectory()&&existsSync(join(root,name,"state.json.tmp"))){const path=join(root,name,"state.json");if(!existsSync(path)||!state(name).pending)abandonedState(path+".tmp",name,existsSync(path)?state(name):undefined);}
    if (existsSync(metaPath)) {
      const meta=readMetadata(),p=meta.pendingRegistration;
      if(p){
        if(!existsSync(join(root,p.filename)))atomic(p.filename,p.record,true);
        const clean={...meta};delete clean.pendingRegistration;atomic("metadata.json",clean,true);
      }
    }
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
          const current = parseRetained(storedEvent,target,100000,"corrupt_record");
          if (canonicalDigest(current) !== canonicalDigest(p.record)) throw new CliError("corrupt_record",3);
        } else atomic(`${name}/${p.filename}`,p.record,true);
        const clean = {...value}; delete clean.pending;
        atomic(`${name}/state.json`,clean,true);
      }
      const current = state(name);
      let acknowledgedDurable=false;
      const sequences = new Set<number>();
      for (const file of readdirSync(directory)) {
        if(performance.now()>=budget)throw new CliError("accounting_deadline");
        if (file === "state.json") continue;
        if (file.endsWith(".tmp")) { remove(join(directory,file)); continue; }
        const match = /^([1-9][0-9]*)-([a-f0-9-]{36})\.json$/.exec(file);
        if (!match) throw new CliError("unexpected_outbox_entry",3);
        const seq = Number(match[1]), record = parseRetained(storedEvent,join(directory,file),100000,"corrupt_record");
        const parsed = validateRecord(record,name,seq);
        if (parsed.eventId !== match[2] || seq > current.allocatedThrough || sequences.has(seq)) throw new CliError("corrupt_record",3);
        if (seq <= current.acknowledgedThrough) {
          if(!acknowledgedDurable){filesystem.syncFile(statePath);filesystem.syncDirectory(directory);acknowledgedDurable=true;}
          remove(join(directory,file));continue;
        }
        sequences.add(seq);
      }
      if (sequences.size !== current.allocatedThrough-current.acknowledgedThrough) throw new CliError("missing_sequence",3);
    }
    lengths();
  }
  async function locked<T>(operation: () => T,until=end): Promise<T> {
    const previous=budget;budget=Math.min(end,until);
    try {
      while (performance.now() < budget) {
        assertPins();
        try { locks[0].exec("BEGIN EXCLUSIVE"); } catch { await new Promise(resolve => setTimeout(resolve,Math.min(20,Math.max(0,budget-performance.now())))); continue; }
        try { recover(); return operation(); } finally { locks[0].exec("ROLLBACK"); }
      }
      throw new CliError("publication_busy");
    }finally{budget=previous;}
  }
  const outbox = {
    async preserveRegistration(path: Registration["path"],key: string,body: Record<string,unknown>) {
      return locked(()=> {
        const name = `registration-${key.toLowerCase()}.json`, file = join(root,name), bodyDigest = canonicalDigest(body);
        if (existsSync(file)) {
          const old = readRegistration(file,name);
          if (canonicalDigest(old.body) !== old.digest) throw new CliError("corrupt_registration",3);
          if (old.path !== path || old.digest !== bodyDigest) throw new CliError("registration_conflict",3);
          return old;
        }
        const meta = readMetadata();
        if (meta.nextOrder === Number.MAX_SAFE_INTEGER) throw new CliError("order_exhausted");
        const record: Registration = {formatVersion:1,path,key,body,digest:bodyDigest,order:meta.nextOrder};
        const clean={...meta,nextOrder:meta.nextOrder+1};
        const descriptor={...clean,pendingRegistration:{record,filename:name,remainingPeak:encodedBytes(record)+encodedBytes(clean)}};
        const peak=Math.max(encodedBytes(descriptor),encodedBytes(descriptor)-lstatSync(metaPath).size+encodedBytes(record)+encodedBytes(clean));
        admit(peak,path === "/runs"?String(body.id).toLowerCase():undefined,encodedBytes(record));
        atomic("metadata.json",descriptor,true);atomic(name,record,true);atomic("metadata.json",clean,true);return record;
      });
    },
    async initializeRun(id: string,until = end) {
      const reply = await request(config,`/runs/${id}`,runResponse,until);
      if (reply.kind !== "delivered") return reply;
      const blocked=await locked(()=> {
        const runId = reply.data.data.id;
        if (runId.toLowerCase() !== id.toLowerCase()) return "run_identity_mismatch" as const;
        const path = join(root,id.toLowerCase(),"state.json");
        if (existsSync(path)) {
          const old = state(id);
          if (reply.data.data.lastSequence < old.acknowledgedThrough || reply.data.data.lastSequence > old.allocatedThrough) return "remote_prefix_mismatch" as const;
          return;
        }
        if (reply.data.data.lastSequence !== 0) return "producer_state_required" as const;
        const value: State = {formatVersion:1,runId,allocatedThrough:0,acknowledgedThrough:0,generation:reply.generation};
        admit(encodedBytes(value),id.toLowerCase()); secureDirectory(join(root,id.toLowerCase())); pin(join(root,id.toLowerCase())); filesystem.syncDirectory(root);
        atomic(`${id.toLowerCase()}/state.json`,value);
      },until);
      return blocked?{kind:"blocked" as const,code:blocked}:reply;
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
        admit(Math.max(encodedBytes(descriptor),encodedBytes(descriptor)-lstatSync(join(root,id.toLowerCase(),"state.json")).size+encodedBytes(record)+encodedBytes(clean)),id.toLowerCase());
        atomic(`${id.toLowerCase()}/state.json`,descriptor,true);
        atomic(`${id.toLowerCase()}/${filename}`,record,true);
        atomic(`${id.toLowerCase()}/state.json`,clean,true);
        return record;
      });
    },
    async next(id: string,until=end) {return locked(()=> {
      const value = state(id);
      if (value.acknowledgedThrough === value.allocatedThrough) return undefined;
      const file = readdirSync(join(root,id.toLowerCase())).find(name=>name.startsWith(`${value.acknowledgedThrough+1}-`));
      if (!file) throw new CliError("missing_sequence",3);
      return parseRetained(storedEvent,join(root,id.toLowerCase(),file),100000,"corrupt_record");
    },until);},
    async acknowledge(record: EventRecord,generation: string,until=end) {return locked(()=> {
      const event = record.body as unknown as EventInput, value = state(event.runId);
      if (value.acknowledgedThrough+1 !== event.sequence) throw new CliError("ack_sequence_mismatch",3);
      atomic(`${event.runId.toLowerCase()}/state.json`,{...value,acknowledgedThrough:event.sequence,generation});
      remove(join(root,event.runId.toLowerCase(),`${event.sequence}-${event.eventId.toLowerCase()}.json`));
    },until);},
    async validateRemote(id: string,generation: string,until: number) {
      const local = await locked(()=>state(id),until);
      if (local.generation === generation) return {kind:"delivered" as const};
      const current = await outbox.initializeRun(id,until);
      if (current.kind === "delivered") await locked(()=>atomic(`${id.toLowerCase()}/state.json`,{...state(id),generation:current.generation}),until);
      return current;
    },
    async jobs() {return locked(()=> {
      const jobs: Job[] = [];
      for (const name of readdirSync(root)) {
        if (name.startsWith("registration-") && name.endsWith(".json")) {
          const record = readRegistration(join(root,name),name);
          if (record.digest !== canonicalDigest(record.body)) throw new CliError("corrupt_registration",3);
          jobs.push({id:`registration:${String(record.order).padStart(16,"0")}:${record.key.toLowerCase()}`,kind:"registration",record});
        } else if (lstatSync(join(root,name)).isDirectory() && existsSync(join(root,name,"state.json"))) {
          const value = state(name);
          if (value.acknowledgedThrough < value.allocatedThrough) jobs.push({id:`run:${name}`,kind:"run",runId:value.runId});
        }
      }
      return jobs.sort((a,b)=>a.id.localeCompare(b.id));
    });},
    async cursor() {return locked(()=>readMetadata().cursor);},
    async advanceCursor(id: string,until=end) {return locked(()=>atomic("metadata.json",{...readMetadata(),cursor:id}),until);},
    async removeRegistration(record: Registration,until=end) {return locked(()=>remove(join(root,`registration-${record.key.toLowerCase()}.json`)),until);},
    acquireDelivery() {assertPins(); try {locks[1].exec("BEGIN EXCLUSIVE"); return true;} catch {return false;}},
    close() {for (const lock of locks) {if (lock.inTransaction) lock.exec("ROLLBACK"); lock.close();}},
  };
  try {await locked(()=>{if (!existsSync(metaPath)) atomic("metadata.json",association);}); return outbox;} catch (error) {outbox.close();throw error;}
}
export type Outbox = Awaited<ReturnType<typeof openOutbox>>;
