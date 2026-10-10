import { z } from "zod";
import { randomUUID } from "node:crypto";
import { uuid } from "../contracts/common";
import { projectCreate } from "../contracts/projects";
import { taskCreate } from "../contracts/tasks";
import { agentCreate, agentResponse, eventInput, eventResponse, runRegister, runResponse } from "../contracts/observations";
import { projectResponse, taskResponse } from "../contracts/responses";
import { CliError, cliConfig, deadline, readJson, type CliConfig } from "./config";
import { request,backoff } from "./http";
import { openOutbox, type Job, type Outbox } from "./outbox";
const commands = {
  "project create": { path: "/projects", input: projectCreate, output: projectResponse },
  "task create": { path: "/tasks", input: taskCreate, output: taskResponse },
  "agent register": { path: "/agents", input: agentCreate, output: agentResponse },
  "run register": { path: "/runs", input: runRegister, output: runResponse },
} as const;
const registrationResponses = {"/projects":projectResponse,"/tasks":taskResponse,"/agents":agentResponse,"/runs":runResponse};
const emit = (value: unknown) => process.stdout.write(JSON.stringify(value)+"\n");
function diagnostic(code: string,runId?: string,details?: {expectedSequence?:number;currentVersion?:number}) {process.stderr.write(JSON.stringify({code,...(runId ? {runId} : {}),...(details?.expectedSequence===undefined?{}:{expectedSequence:details.expectedSequence}),...(details?.currentVersion===undefined?{}:{currentVersion:details.currentVersion}),repair:"Preserve the outbox. Resolve rejected references or restore the original producer state. Retry uncertain delivery with flush."})+"\n");}
async function turn(job: Job,outbox: Outbox,config: CliConfig,end: number,beforeAttempt?:()=>Promise<void>) {
  if (job.kind === "registration") {
    const record = job.record;
    await beforeAttempt?.();
    const reply = await request(config,record.path,registrationResponses[record.path] as z.ZodType<{data:{id:string}}>,end,record.body,record.key);
    if (reply.kind !== "delivered") return reply;
    if (record.path === "/runs") {
      const initialized = await outbox.initializeRun(reply.data.data.id,end);
      if (initialized.kind !== "delivered") return initialized;
    }
    await outbox.removeRegistration(record,end); emit({id:reply.data.data.id,generation:reply.generation}); return reply;
  }
  const record = await outbox.next(job.runId,end);
  if (!record) return {kind:"delivered" as const,complete:true};
  await beforeAttempt?.();
  const reply = await request(config,`/runs/${job.runId}/events`,eventResponse,end,record.body);
  if(reply.kind==="blocked"&&reply.code==="sequence_gap"&&reply.expectedSequence===record.body.sequence)return{kind:"retryable" as const,delay:100};
  if (reply.kind !== "delivered") return reply;
  const ack = reply.data.data;
  if (ack.eventId.toLowerCase() !== String(record.body.eventId).toLowerCase() || ack.runId.toLowerCase() !== String(record.body.runId).toLowerCase() || ack.acceptedSequence !== record.body.sequence) return {kind:"blocked" as const,code:"ack_identity_mismatch"};
  const validated = await outbox.validateRemote(job.runId,reply.generation,end);
  if (validated.kind !== "delivered") return validated;
  await outbox.acknowledge(record,reply.generation,end); emit({...ack,generation:reply.generation}); return {...reply,complete:!await outbox.next(job.runId,end)};
}
export async function main(args = process.argv.slice(2), open = openOutbox) {
  const end = deadline();
  let outbox: Outbox | undefined;
  let preserved=false,knownPending=false,cursorWriting=false;
  let blockedExit=0;
  try {
    if (args.length === 1 && ["--help","help"].includes(args[0])) {process.stdout.write("agentflow project create | task create | agent register | run register --file <json> --idempotency-key <uuid>\nagentflow report --run <uuid> --type <event-type> --payload <json>\nagentflow flush [--run <uuid>]\nAll commands accept --port <port>.\n");return 0;}
    const command = commands[args.slice(0,2).join(" ") as keyof typeof commands];
    const action = command ? "register" : args[0];
    if (!["register","report","flush"].includes(action)) throw new CliError("invalid_command");
    const allowed = command ? ["--file","--idempotency-key","--port"] : action === "report" ? ["--run","--type","--payload","--port"] : ["--run","--port"];
    const flags: Record<string,string> = {};
    for (let i = command ? 2 : 1; i < args.length; i += 2) {
      const flag = args[i];
      if (!allowed.includes(flag) || flags[flag] !== undefined || !args[i+1] || args[i+1].startsWith("--")) throw new CliError("invalid_arguments");
      flags[flag] = args[i+1];
    }
    if (flags["--run"] && !uuid.safeParse(flags["--run"]).success) throw new CliError("invalid_arguments");
    const config = cliConfig(flags["--port"]);
    let body: Record<string,unknown> | undefined;
    if (command) {
      if (!flags["--file"] || !uuid.safeParse(flags["--idempotency-key"]).success) throw new CliError("invalid_arguments");
      body = readJson(flags["--file"]);
      if (!command.input.safeParse(body).success || Buffer.byteLength(JSON.stringify(body))>65536) throw new CliError("invalid_input");
    } else if (action === "report") {
      if (!flags["--run"] || !flags["--payload"] || !flags["--type"]) throw new CliError("invalid_arguments");
      body = readJson(flags["--payload"]);
      if (!eventInput.safeParse({schemaVersion:1,eventId:randomUUID(),runId:flags["--run"],sequence:1,type:flags["--type"],occurredAt:new Date().toISOString(),payload:body}).success) throw new CliError("invalid_input");
    }
    outbox = await open(config,end);
    let selected: Job | undefined;
    if (command) {
      const record = await outbox.preserveRegistration(command.path,flags["--idempotency-key"],body!);
      preserved=true;
      selected = {kind:"registration",id:record.key,record};
    } else if (action === "report") {
      const runId = flags["--run"];
      if (!await outbox.tracked(runId)) {
        const adopted = await outbox.initializeRun(runId);
        if (adopted.kind !== "delivered") throw new CliError(adopted.kind === "blocked" ? adopted.code : "producer_state_required",3);
      }
      await outbox.enqueue(runId,flags["--type"],body!);
      preserved=true;
      selected = {kind:"run",id:`run:${runId.toLowerCase()}`,runId};
    } else if (flags["--run"]) {
      if (!await outbox.tracked(flags["--run"])) throw new CliError("producer_state_required",3);
      selected = {kind:"run",id:`run:${flags["--run"].toLowerCase()}`,runId:flags["--run"]};
    }
    if (!outbox.acquireDelivery()) {diagnostic("queued");return 2;}
    const jobs=selected?[selected]:await outbox.jobs();
    if(!jobs.length)return 0;
    knownPending=true;
    const dependencies=selected?await outbox.jobs():jobs;
    const cursor=selected?null:await outbox.cursor();
    let position=cursor?jobs.findIndex(job=>job.id>=cursor):0;if(position<0)position=0;
    const done=new Set<string>(),blocked=new Set<string>(),attempted=new Set<string>();
    const retries=new Map<string,{count:number;at:number}>();
    function dependent(job:Job) {
      const registrations=dependencies.filter(other=>other.kind==="registration"&&!done.has(other.id));
      if(job.kind==="run")return registrations.some(other=>other.kind==="registration"&&other.record.path==="/runs"&&String(other.record.body.id).toLowerCase()===job.runId.toLowerCase());
      if(job.record.path!=="/runs")return false;
      return registrations.some(other=>other.id!==job.id&&other.kind==="registration"&&other.record.path==="/agents"&&typeof other.record.body.id==="string"&&other.record.body.id.toLowerCase()===String(job.record.body.agentId).toLowerCase());
    }
    while(performance.now()<end) {
      const eligible=jobs.filter(job=>!done.has(job.id)&&!blocked.has(job.id)&&!dependent(job));
      if(!eligible.length)return blockedExit||2;
      const first=eligible.filter(job=>!attempted.has(job.id));
      const ready=first.length?first:eligible.filter(job=>(retries.get(job.id)?.at??0)<=performance.now());
      if(!ready.length){const next=Math.min(...eligible.map(job=>retries.get(job.id)?.at??0));await new Promise(resolve=>setTimeout(resolve,Math.min(Math.max(0,next-performance.now()),Math.max(0,end-performance.now()))));continue;}
      let index=position;
      for(let offset=0;offset<jobs.length;offset++){const candidate=(position+offset)%jobs.length;if(ready.some(job=>job.id===jobs[candidate].id)){index=candidate;break;}}
      const job=jobs[index],until=Math.min(end,performance.now()+500);
      position=(index+1)%jobs.length;
      attempted.add(job.id);
      const reply=await turn(job,outbox,config,until,selected?undefined:async()=>{cursorWriting=true;await outbox!.advanceCursor(jobs[position].id,until);cursorWriting=false;});
      if(reply.kind==="blocked"){diagnostic(reply.code,job.kind==="run"?job.runId:job.record.path==="/runs"?String(job.record.body.id):undefined,reply);blocked.add(job.id);blockedExit=3;continue;}
      if(reply.kind==="delivered") {
        if(job.kind==="registration"||"complete"in reply&&reply.complete)done.add(job.id);
        retries.delete(job.id);
        if(done.size===jobs.length)return blockedExit;
        // A run with a remaining FIFO event gets a new first turn.
        attempted.delete(job.id);continue;
      }
      const count=(retries.get(job.id)?.count??0)+1;
      retries.set(job.id,{count,at:performance.now()+backoff(count,reply.delay)});
    }
    diagnostic("queued");return blockedExit||2;
  } catch (error) {
    if(!cursorWriting&&(preserved||knownPending)&&error instanceof CliError&&["accounting_deadline","publication_busy"].includes(error.code)){diagnostic("queued");return blockedExit||2;}
    diagnostic(error instanceof CliError ? error.code : "local_failure");
    return error instanceof CliError ? error.exit : 1;
  } finally {outbox?.close();}
}
if (import.meta.url === new URL(process.argv[1],"file:").href) process.exitCode = await main();
