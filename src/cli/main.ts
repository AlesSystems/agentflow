import { z } from "zod";
import { randomUUID } from "node:crypto";
import { uuid } from "../contracts/common";
import { projectCreate } from "../contracts/projects";
import { taskCreate } from "../contracts/tasks";
import { agentCreate, agentResponse, eventInput, eventResponse, runRegister, runResponse } from "../contracts/observations";
import { taskRegistrationResponse } from "../contracts/task-registration";
import * as workflows from "../contracts/workflows";
import { projectResponse, taskResponse } from "../contracts/responses";
import { CliError, cliConfig, deadline, readJson, type CliConfig } from "./config";
import { request,backoff } from "./http";
import { openOutbox, CursorAdmissionTimeout, type Job, type Outbox, type EventRecord, type ProducerRef, registrationInput } from "./outbox";
const commands = {
  "register workflow": { path: "/workflows", input: workflows.workflowCreate, output: workflows.workflowResponse },
  "register workflow-revision": { path: "/workflow-revisions", input: workflows.planRevisionCreate, output: workflows.revisionAcknowledgementResponse },
  "register workflow-run": { path: "/workflow-runs", input: workflows.workflowRunRegister, output: workflows.workflowRunResponse },
  "project create": { path: "/projects", input: projectCreate, output: projectResponse },
  "task create": { path: "/tasks", input: taskCreate, output: taskResponse },
  "agent register": { path: "/agents", input: agentCreate, output: agentResponse },
  "run register": { path: "/runs", input: runRegister, output: runResponse },
} as const;
const registrationResponses = {"/projects":projectResponse,"/tasks":taskResponse,"/agents":agentResponse,"/runs":runResponse};
type RegistrationResponse = { data: { id: string; projectId?: string; parentTaskId?: string | null; assignedAgentId?: string | null; version?: number; workRevision?: number | null; workflowId?: string; planRevisionId?: string; revision?: number }; snapshotCursor: string; generation: string };
function registrationResponse(path: string): z.ZodType<RegistrationResponse> {
  if(path === "/tasks")return z.union([taskRegistrationResponse,taskResponse]);
  if(path === "/workflows")return workflows.workflowResponse;
  if(path === "/workflow-runs")return workflows.workflowRunResponse;
  if(path.startsWith("/workflows/")&&registrationInput(path))return workflows.revisionAcknowledgementResponse;
  const schema=registrationResponses[path as keyof typeof registrationResponses];
  if(!schema)throw new CliError("corrupt_registration",3);
  return schema;
}
const jobProducer = (job: Exclude<Job,{kind:"registration"}>): ProducerRef => ({kind:job.kind,id:job.runId.toLowerCase()});
const emit = (value: unknown) => process.stdout.write(JSON.stringify(value)+"\n");
const evidenceRepairs: Record<string,string> = {
  dependencies_not_ready: "Preserve the outbox. An operator must accept current prerequisite work in the browser. Retry unchanged registration with flush after readiness is restored.",
  review_tuple_required: "Preserve the outbox. Review registration needs the current work revision, artifact reference and rework round. Resolve tracking ownership in the browser before preparing a new attempt.",
  review_tuple_obsolete: "Preserve the outbox. The captured evidence is obsolete. Resolve tracking ownership in the browser, then register a new attempt with the current evidence tuple.",
  decision_required: "Preserve the outbox. Required gates need an explicit decision and evidence note. Resolve tracking ownership in the browser before preparing a valid new attempt; do not rewrite pending bytes.",
  decision_purpose_invalid: "Preserve the outbox. Only review or verification attempts may report decisions. Prepare a valid attempt after resolving current tracking ownership.",
  artifact_purpose_invalid: "Preserve the outbox. Only implementation success may publish an artifact. Prepare a valid observation after resolving current tracking ownership.",
};
function diagnostic(code: string,runId?: string,details?: {expectedSequence?:number;currentVersion?:number}) {process.stderr.write(JSON.stringify({code,...(runId ? {runId} : {}),...(details?.expectedSequence===undefined?{}:{expectedSequence:details.expectedSequence}),...(details?.currentVersion===undefined?{}:{currentVersion:details.currentVersion}),repair:evidenceRepairs[code] ?? "Preserve the outbox. Resolve rejected references or restore the original producer state. Retry uncertain delivery with flush."})+"\n");}
async function turn(job: Job,outbox: Outbox,config: CliConfig,end: number,beforeAttempt?:()=>Promise<void>,selectEvent?:()=>Promise<EventRecord|undefined>) {
  if (job.kind === "registration") {
    const record = job.record;
    await beforeAttempt?.();
    const reply = await request(config,record.path,registrationResponse(record.path),end,record.body,record.key,record.path === "/tasks" ? "return=minimal" : undefined);
    if (reply.kind !== "delivered") return reply;
    const data=reply.data.data;
    if(record.path === "/tasks") {
      const input=taskCreate.parse(record.body);
      const same=(actual: string | null | undefined, expected: string | null | undefined)=>actual?.toLowerCase() === (expected?.toLowerCase() ?? null) || actual === null && expected == null;
      if(data.projectId?.toLowerCase() !== input.projectId || !same(data.parentTaskId,input.parentTaskId) || !same(data.assignedAgentId,input.assignedAgentId) || data.version !== 1 || data.workRevision !== 1)return {kind:"blocked" as const,code:"registration_identity_mismatch"};
    }
    if(typeof record.body.id === "string" && data.id.toLowerCase() !== record.body.id.toLowerCase()) return {kind:"blocked" as const,code:"registration_identity_mismatch"};
    if(record.path.startsWith("/workflows/") && data.workflowId !== record.path.split("/")[2])return {kind:"blocked" as const,code:"registration_identity_mismatch"};
    if(record.path === "/workflow-runs" && (data.workflowId !== String(record.body.workflowId).toLowerCase() || data.planRevisionId !== String(record.body.planRevisionId).toLowerCase()))return {kind:"blocked" as const,code:"registration_identity_mismatch"};
    if (record.path === "/runs" || record.path === "/workflow-runs") {
      const initialized = await outbox.initializeRun({kind:record.path === "/runs" ? "run" : "workflow-run",id:reply.data.data.id},end);
      if (initialized.kind !== "delivered") return initialized;
    }
    await outbox.removeRegistration(record,end); emit({id:data.id,...(record.path === "/workflows" ? {version:data.version} : record.path.startsWith("/workflows/") ? {workflowId:data.workflowId,revision:data.revision} : record.path === "/workflow-runs" ? {workflowId:data.workflowId,planRevisionId:data.planRevisionId} : {}),generation:reply.generation}); return reply;
  }
  const record = selectEvent ? await selectEvent() : await outbox.next(jobProducer(job),end);
  if (!record) return {kind:"delivered" as const,complete:true};
  if(!selectEvent)await beforeAttempt?.();
  const ref=jobProducer(job);
  const reply = job.kind === "run" ? await request(config,`/runs/${ref.id}/events`,eventResponse,end,record.body) : await request(config,`/workflow-runs/${ref.id}/events`,workflows.workflowEventResponse,end,record.body);
  if(reply.kind==="blocked"&&reply.code==="sequence_gap"&&reply.expectedSequence===record.body.sequence)return{kind:"retryable" as const,delay:100};
  if (reply.kind !== "delivered") return reply;
  const ack = reply.data.data;
  if (ack.eventId.toLowerCase() !== String(record.body.eventId).toLowerCase() || ("runId" in ack ? ack.runId : ack.workflowRunId).toLowerCase() !== ref.id || (record.producerKind??"run")!==ref.kind || ack.acceptedSequence !== record.body.sequence) return {kind:"blocked" as const,code:"ack_identity_mismatch"};
  const validated = await outbox.validateRemote(ref,reply.generation,end);
  if (validated.kind !== "delivered") return validated;
  const result=await outbox.acknowledge(record,reply.generation,end); emit({...ack,generation:reply.generation}); return {...reply,complete:result.complete};
}
export async function main(args = process.argv.slice(2), open = openOutbox) {
  const end = deadline();
  let outbox: Outbox | undefined;
  let preserved=false,knownPending=false,cursorWriting=false;
  let blockedExit=0;
  try {
    if (args.length === 1 && ["--help","help"].includes(args[0])) {process.stdout.write("agentflow project create | task create | agent register | run register --file <json> --idempotency-key <uuid>\nagentflow register workflow | workflow-revision --workflow <uuid> | workflow-run --file <json> --idempotency-key <uuid>\nagentflow report --run <uuid> | --workflow-run <uuid> --type <event-type> --payload <json>\nagentflow flush [--run <uuid>]\nAll commands accept --port <port>.\n");return 0;}
    const command = commands[args.slice(0,2).join(" ") as keyof typeof commands];
    const action = command ? "register" : args[0];
    if (!["register","report","flush"].includes(action)) throw new CliError("invalid_command");
    const allowed = command ? ["--file","--idempotency-key","--port",...(command.path === "/workflow-revisions" ? ["--workflow"] : [])] : action === "report" ? ["--run","--workflow-run","--type","--payload","--port"] : ["--run","--workflow-run","--port"];
    const flags: Record<string,string> = {};
    for (let i = command ? 2 : 1; i < args.length; i += 2) {
      const flag = args[i];
      if (!allowed.includes(flag) || flags[flag] !== undefined || !args[i+1] || args[i+1].startsWith("--")) throw new CliError("invalid_arguments");
      flags[flag] = args[i+1];
    }
    if(flags["--run"]&&flags["--workflow-run"])throw new CliError("invalid_arguments");
    for(const flag of ["--run","--workflow-run","--workflow"])if(flags[flag]){if(!uuid.safeParse(flags[flag]).success)throw new CliError("invalid_arguments");flags[flag]=flags[flag].toLowerCase();}
    const producer: ProducerRef | undefined = flags["--run"] ? {kind:"run",id:flags["--run"]} : flags["--workflow-run"] ? {kind:"workflow-run",id:flags["--workflow-run"]} : undefined;
    const commandPath=command?.path === "/workflow-revisions" ? flags["--workflow"] ? `/workflows/${flags["--workflow"]}/revisions` : undefined : command?.path;
    if(command&&!commandPath)throw new CliError("invalid_arguments");
    const config = cliConfig(flags["--port"]);
    let body: Record<string,unknown> | undefined;
    if (command) {
      if (!flags["--file"] || !uuid.safeParse(flags["--idempotency-key"]).success) throw new CliError("invalid_arguments");
      body = readJson(flags["--file"]);
      if (!command.input.safeParse(body).success || Buffer.byteLength(JSON.stringify(body))>65536) throw new CliError("invalid_input");
    } else if (action === "report") {
      if (!producer || !flags["--payload"] || !flags["--type"]) throw new CliError("invalid_arguments");
      body = readJson(flags["--payload"]);
      if (!(producer!.kind === "run" ? eventInput : workflows.workflowEventInput).safeParse({schemaVersion:1,eventId:randomUUID(),...(producer!.kind === "run" ? {runId:producer!.id} : {workflowRunId:producer!.id}),sequence:1,type:flags["--type"],occurredAt:new Date().toISOString(),payload:body}).success) throw new CliError("invalid_input");
    }
    outbox = await open(config,end);
    let selected: Job | undefined;
    if (command) {
      const record = await outbox.preserveRegistration(commandPath!,flags["--idempotency-key"],body!);
      preserved=true;
      selected = {kind:"registration",id:`registration:${String(record.order).padStart(16,"0")}:${record.key.toLowerCase()}`,record};
    } else if (action === "report") {
      const ref = producer!;
      if (!await outbox.tracked(ref)) {
        const adopted = await outbox.initializeRun(ref);
        if (adopted.kind !== "delivered") throw new CliError(adopted.kind === "blocked" ? adopted.code : "producer_state_required",3);
      }
      await outbox.enqueue(ref,flags["--type"],body!);
      preserved=true;
      selected = {kind:ref.kind,id:`${ref.kind}:${ref.id}`,runId:ref.id};
    } else if (producer) {
      if (!await outbox.tracked(producer)) throw new CliError("producer_state_required",3);
      selected = {kind:producer.kind,id:`${producer.kind}:${producer.id}`,runId:producer.id};
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
      const registrations=dependencies.filter((other): other is Extract<Job,{kind:"registration"}>=>other.kind==="registration"&&!done.has(other.id)&&other.id!==job.id);
      if(job.kind!=="registration")return registrations.some(other=>other.record.path===(job.kind === "run" ? "/runs" : "/workflow-runs")&&String(other.record.body.id).toLowerCase()===job.runId.toLowerCase());
      const record=job.record;
      if(record.path === "/runs")return registrations.some(other=>other.record.path==="/agents"&&typeof other.record.body.id==="string"&&other.record.body.id.toLowerCase()===String(record.body.agentId).toLowerCase());
      if(record.path.startsWith("/workflows/"))return registrations.some(other=>other.record.path==="/workflows"&&String(other.record.body.id).toLowerCase()===record.path.split("/")[2]);
      if(record.path === "/workflow-runs")return registrations.some(other=>other.record.path==="/workflows"&&String(other.record.body.id).toLowerCase()===String(record.body.workflowId).toLowerCase() || other.record.path===`/workflows/${String(record.body.workflowId).toLowerCase()}/revisions`&&String(other.record.body.id).toLowerCase()===String(record.body.planRevisionId).toLowerCase());
      return false;
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
      const reply=await turn(job,outbox,config,until,selected?undefined:async()=>{cursorWriting=true;await outbox!.advanceCursor(jobs[position].id,until);cursorWriting=false;},selected||job.kind==="registration"?undefined:async()=>{cursorWriting=true;const record=await outbox!.selectForTurn(jobProducer(job),jobs[position].id,until);cursorWriting=false;return record;});
      if(reply.kind==="blocked"){diagnostic(reply.code,job.kind!=="registration"?job.runId:job.record.path==="/runs"||job.record.path==="/workflow-runs"?String(job.record.body.id):undefined,reply);blocked.add(job.id);blockedExit=3;continue;}
      if(reply.kind==="delivered") {
        if(job.kind==="registration"||"complete"in reply&&reply.complete)done.add(job.id);
        retries.delete(job.id);
        if(done.size===jobs.length)return blockedExit;
        continue;
      }
      const count=(retries.get(job.id)?.count??0)+1;
      retries.set(job.id,{count,at:performance.now()+backoff(count,reply.delay)});
    }
    diagnostic("queued");return blockedExit||2;
  } catch (error) {
    if((preserved||knownPending)&&error instanceof CursorAdmissionTimeout){diagnostic("queued");return blockedExit||2;}
    if(!cursorWriting&&(preserved||knownPending)&&error instanceof CliError&&["accounting_deadline","publication_busy"].includes(error.code)){diagnostic("queued");return blockedExit||2;}
    diagnostic(error instanceof CliError ? error.code : "local_failure");
    return error instanceof CliError ? error.exit : 1;
  } finally {outbox?.close();}
}
if (import.meta.url === new URL(process.argv[1],"file:").href) process.exitCode = await main();
