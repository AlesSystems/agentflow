import type { UsageQuery, PriceSnapshotCreate, PageQuery } from "../contracts/usage";
import { UsageData } from "./usage";
import type { RetentionPreviewInput, RetentionPruneInput } from "../contracts/history";
import { HistoryData } from "./history";
import { GithubData } from "./github";
import type { GithubRepositoriesInput, GithubRefreshInput, GithubQuery } from "../contracts/github";
import * as evidence from "../contracts/evidence";
import { validateDependencies, deriveReadiness } from "../workflows/dependencies";
import { sameTuple } from "../workflows/reviews";
import * as workflows from "../contracts/workflows";
import { validateWorkflowPlan, decideWorkflowEvent, workflowFreshness } from "../domain/workflows";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  projectCreate,
  projectPatch,
  projectQuery,
  project,
} from "../contracts/projects";
import {
  taskCreate,
  taskPatch,
  completeInput,
  reopenInput,
  commentInput,
  taskQuery,
  taskDetailQueryV1,
  boardQuery,
  task,
} from "../contracts/tasks";
import { settingsPatch } from "../contracts/settings";
import { canonicalDigest } from "../domain/request-digest";
import { localDate, localDayInterval } from "../domain/local-day";
import {
  Conflict,
  decideTask,
  type TaskCommand,
  type TaskFacts,
} from "../domain/tasks";
import {
  agentCreate,
  agentPatch,
  runRegister,
  runQuery,
  agentQuery,
  eventQuery,
  closeInput,
  eventInput,
  type Run,
} from "../contracts/observations";
import { run } from "../contracts/tasks";
import { nextRegistrationOrder, nextWorkflowRegistrationOrder } from "./registration-order";
import {
  decideRegistration,
  decideEvent,
  decideClose,
  observationFreshness,
} from "../domain/runs";
import { activityQuery } from "../contracts/tracking";
export type ApplicationCommand =
  | {kind:"usage.price.create";input:PriceSnapshotCreate}
  | {kind:"retention.preview";input:RetentionPreviewInput}
  | {kind:"retention.prune";input:RetentionPruneInput}
  | {kind:"github.repositories";input:GithubRepositoriesInput}
  | {kind:"github.refresh";input:GithubRefreshInput}
  | { kind: "task.dependencies"; id: string; input: z.infer<typeof evidence.dependenciesInput> }
  | { kind: "task.review-policy"; id: string; input: z.infer<typeof evidence.reviewPolicyInput> }
  | { kind: "task.artifact"; id: string; input: z.infer<typeof evidence.artifactInput> }
  | { kind: "task.rework"; id: string; input: z.infer<typeof evidence.reworkInput> }
  | { kind: "workflow.run.register"; input: z.infer<typeof workflows.workflowRunRegister> }
  | { kind: "workflow.run.event"; id: string; input: workflows.WorkflowEventInput }
  | { kind: "workflow.run.close"; id: string; input: z.infer<typeof workflows.workflowClose> }
  | { kind: "workflow.create"; input: z.infer<typeof workflows.workflowCreate> }
  | { kind: "workflow.revision"; id: string; input: z.infer<typeof workflows.planRevisionCreate> }
  | { kind: "agent.create"; input: z.infer<typeof agentCreate> }
  | { kind: "agent.patch"; id: string; input: z.infer<typeof agentPatch> }
  | { kind: "run.register"; input: z.infer<typeof runRegister> }
  | { kind: "run.close"; id: string; input: z.infer<typeof closeInput> }
  | { kind: "run.event"; id: string; input: z.infer<typeof eventInput> }
  | { kind: "project.create"; input: z.infer<typeof projectCreate> }
  | { kind: "project.patch"; id: string; input: z.infer<typeof projectPatch> }
  | { kind: "task.create"; input: z.infer<typeof taskCreate> }
  | { kind: "task.patch"; id: string; input: z.infer<typeof taskPatch> }
  | { kind: "task.complete"; id: string; input: z.infer<typeof completeInput> }
  | { kind: "task.reopen"; id: string; input: z.infer<typeof reopenInput> }
  | { kind: "comment.create"; id: string; input: z.infer<typeof commentInput> }
  | { kind: "settings.patch"; input: z.infer<typeof settingsPatch> };
export type ApplicationQuery =
  | {kind:"usage";input:UsageQuery}
  | {kind:"usage.prices";input:PageQuery}
  | {kind:"github";input:GithubQuery}
  | { kind: "workflow.readiness"; id: string; revisionId: string }
  | { kind: "task.readiness"; id: string }
  | { kind: "task.decisions"; id: string; input: z.infer<typeof evidence.evidenceQuery> }
  | { kind: "task.reworks"; id: string; input: z.infer<typeof evidence.evidenceQuery> }
  | { kind: "task.evidence"; id: string; input: z.infer<typeof evidence.evidenceQuery> }
  | { kind: "workflow.runs"; input: z.infer<typeof workflows.workflowRunQuery> }
  | { kind: "workflow.run"; id: string }
  | { kind: "workflow.run.summary"; id: string }
  | { kind: "workflow.events"; id: string; input: z.infer<typeof workflows.workflowHistoryQuery> }
  | { kind: "workflow.nodes"; id: string; nodeId: string; input: z.infer<typeof workflows.workflowHistoryQuery> }
  | { kind: "workflows"; input: z.infer<typeof workflows.workflowQuery> }
  | { kind: "workflow"; id: string }
  | { kind: "workflow.revisions"; id: string; input: z.infer<typeof workflows.workflowHistoryQuery> }
  | { kind: "workflow.revision"; id: string; revisionId: string }
  | { kind: "tracking.agents"; input: z.infer<typeof agentQuery> }
  | { kind: "tracking.runs"; input: z.infer<typeof runQuery> }
  | { kind: "tracking.run"; id: string }
  | { kind: "tracking.tasks"; input: z.infer<typeof taskQuery> }
  | { kind: "tracking.board"; id: string; input: z.infer<typeof boardQuery> }
  | { kind: "activity"; input: z.infer<typeof activityQuery> }
  | { kind: "agents"; input: z.infer<typeof agentQuery> }
  | { kind: "agent"; id: string }
  | { kind: "runs"; input: z.infer<typeof runQuery> }
  | { kind: "run"; id: string }
  | { kind: "events"; id: string; input: z.infer<typeof eventQuery> }
  | { kind: "projects"; input: z.infer<typeof projectQuery> }
  | { kind: "project"; id: string }
  | { kind: "tasks"; input: z.infer<typeof taskQuery> }
  | { kind: "task"; id: string; input: z.infer<typeof taskDetailQueryV1> }
  | { kind: "comments"; id: string; input: { limit: number; cursor?: string } }
  | { kind: "board"; id: string; input: z.infer<typeof boardQuery> }
  | { kind: "settings" }
  | {
      kind: "overview";
      input: { timezone?: string; limit: number; cursor?: string };
    };
export type CommandContext = {
  principal: "operator" | "reporter";
  method: string;
  path: string;
  key: string;
  digest: string;
  now: number;
};
export type SnapshotBody = {
  data: unknown;
  snapshotCursor: string;
  generation: string;
};
export type CommittedReply = { status: number; body: SnapshotBody };
type Row = Record<string, unknown>;
const camel = (key: string) =>
  key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
const snake = (key: string) =>
  key.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase());
function serialize(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      camel(key),
      ["review_required", "verification_required"].includes(key) ? !!value :
      ["tags", "nodes", "edges"].includes(key)
        ? JSON.parse(value as string)
        : key.endsWith("_at") && value !== null
          ? new Date(value as number).toISOString()
          : value,
    ]),
  );
}
function persisted(record: Row): Row {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      snake(key),
      ["reviewRequired", "verificationRequired"].includes(key) ? Number(value) :
      ["tags", "nodes", "edges"].includes(key)
        ? JSON.stringify(value)
        : key.endsWith("At") && value !== null
          ? Date.parse(value as string)
          : value,
    ]),
  );
}
export class ApplicationData {
  constructor(
    private readonly db: Database.Database,
    private readonly dataDir: string,
  ) {}
  private find(table: string, id: string, column = "id") {
    const rows = this.db
      .prepare(
        `SELECT * FROM ${table} WHERE ${column}=? COLLATE NOCASE LIMIT 2`,
      )
      .all(id) as Row[];
    if (rows.length > 1) throw new Conflict("identity_ambiguous");
    return rows[0];
  }
  private one(table: string, id: string) {
    const row = this.find(table, id);
    if (!row) throw new Conflict("resource_not_found");
    return serialize(row);
  }
  private reference(table: string, id: string | null | undefined) {
    return id ? (this.one(table, id).id as string) : id;
  }
  private insert(table: string, row: Row) {
    const values = persisted(row);
    const keys = Object.keys(values);
    this.db
      .prepare(
        `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      )
      .run(...Object.values(values));
  }
  private update(table: string, row: Row) {
    const values = persisted(row);
    delete values.id;
    this.db
      .prepare(
        `UPDATE ${table} SET ${Object.keys(values)
          .map((key) => `${key}=?`)
          .join(",")} WHERE id=?`,
      )
      .run(...Object.values(values), row.id);
  }
  private change(
    entityType: string,
    entityId: string,
    projectId: string | null,
    kind: string,
    now: number,
  ) {
    this.db
      .prepare(
        "INSERT INTO changes(entity_type,entity_id,project_id,kind,received_at) VALUES(?,?,?,?,?)",
      )
      .run(entityType, entityId, projectId, kind, now);
  }
  private body(data: unknown): SnapshotBody {
    const { generation } = this.db
      .prepare("SELECT generation FROM instance_metadata WHERE singleton=1")
      .get() as { generation: string };
    const { cursor } = this.db
      .prepare(
        "SELECT CAST(coalesce(max(cursor),0) AS TEXT) AS cursor FROM changes",
      )
      .get() as { cursor: string };
    return { data, snapshotCursor: cursor, generation };
  }
  private activeProject(projectId: string) {
    const value = project.parse(this.one("projects", projectId));
    if (value.archivedAt) throw new Conflict("project_archived");
    return value;
  }
  private references(
    projectId: string,
    parentId: string | null | undefined,
    agentId: string | null | undefined,
  ): string[] {
    if (agentId) this.one("agents", agentId);
    const ancestors: string[] = [];
    let current = parentId;
    while (current) {
      const parent = task.parse(this.one("tasks", current));
      if (parent.projectId !== projectId)
        throw new Conflict("parent_project_mismatch");
      if (ancestors.includes(parent.id)) throw new Conflict("parent_cycle");
      ancestors.push(parent.id);
      current = parent.parentTaskId;
    }
    return ancestors;
  }
  private facts(value: z.infer<typeof task>, ancestors: string[]): TaskFacts {
    const latest = this.db
      .prepare(
        "SELECT id,state,work_revision AS workRevision FROM runs WHERE task_id=? AND purpose='implementation' ORDER BY registration_order DESC LIMIT 1",
      )
      .get(value.id) as TaskFacts["latestImplementation"] | undefined;
    return {
      projectArchived: !!this.one("projects", value.projectId).archivedAt,
      activeRun: !!this.db
        .prepare(
          "SELECT 1 FROM runs WHERE task_id=? AND state IN ('queued','running') LIMIT 1",
        )
        .get(value.id),
      latestImplementation: latest ?? null,
      hasImplementationHistory: !!latest,
      ancestorIds: ancestors,
      readiness: this.readiness(value.id),
      evidence: this.evidence(value),
    };
  }
  private acceptanceSnapshots(values: z.infer<typeof task>[]) {
    const result = new Map<string, {readiness:evidence.TaskReadiness;evidence:evidence.TaskGateSummary}>();
    if (!values.length) return result;
    const ids = values.map(value => value.id);
    const placeholders = ids.map(() => "?").join(",");
    const dependencies = this.db.prepare(`SELECT d.task_id AS ownerId,p.id AS taskId,p.work_revision AS currentWorkRevision,p.status,
      (SELECT max(work_revision) FROM completions WHERE task_id=p.id) AS acceptedWorkRevision
      FROM task_dependencies d JOIN tasks p ON p.id=d.prerequisite_id WHERE d.task_id IN (${placeholders}) ORDER BY d.task_id,p.id`).all(...ids) as (Parameters<typeof deriveReadiness>[0][number] & {ownerId:string})[];
    const currentArtifactJoin = "a.task_id=t.id AND a.work_revision=t.work_revision AND a.rework_round=t.rework_round";
    const artifacts = this.db.prepare(`SELECT a.* FROM tasks t JOIN task_artifacts a ON ${currentArtifactJoin} WHERE t.id IN (${placeholders})`).all(...ids) as Row[];
    const currentArtifacts = new Map(artifacts.map(row => { const value=evidence.artifactEvidence.parse(serialize(row));return [value.taskId,value]; }));
    const gateQuery = (purpose: "review" | "verification") => `SELECT t.id AS owner_id,t.${purpose}_required AS required,'${purpose}' AS gate,
      EXISTS(SELECT 1 FROM gate_decisions d WHERE d.task_id=t.id AND d.work_revision=t.work_revision AND d.artifact_ref=a.artifact_ref AND d.rework_round=t.rework_round AND d.purpose='${purpose}' AND d.decision='approved') AS approved,
      EXISTS(SELECT 1 FROM gate_decisions d WHERE d.task_id=t.id AND d.work_revision=t.work_revision AND d.artifact_ref=a.artifact_ref AND d.rework_round=t.rework_round AND d.purpose='${purpose}' AND d.decision='changes_requested') AS changes_requested,g.*
      FROM tasks t LEFT JOIN task_artifacts a ON ${currentArtifactJoin}
      LEFT JOIN gate_decisions g ON g.id=(SELECT id FROM gate_decisions WHERE task_id=t.id AND work_revision=t.work_revision AND artifact_ref=a.artifact_ref AND rework_round=t.rework_round AND purpose='${purpose}' ORDER BY created_at DESC,id DESC LIMIT 1)
      WHERE t.id IN (${placeholders})`;
    const decisions = this.db.prepare(gateQuery("review")+" UNION ALL "+gateQuery("verification")).all(...ids,...ids) as Row[];
    const gates = new Map<string,z.infer<typeof evidence.gateSummary>>();
    for (const row of decisions) {
      const {ownerId,required,gate,approved,changesRequested,...fact} = serialize(row);
      gates.set(ownerId+":"+gate,{required:!!required,approved:!!approved,changesRequested:!!changesRequested,latestDecision:fact.id ? evidence.gateDecision.parse(fact) : null});
    }
    const implementations = this.db.prepare(`SELECT t.id,r.state,r.work_revision FROM tasks t LEFT JOIN runs r ON r.registration_order=(SELECT max(registration_order) FROM runs WHERE task_id=t.id AND purpose='implementation') WHERE t.id IN (${placeholders})`).all(...ids) as {id:string;state:string|null;work_revision:number|null}[];
    const latest = new Map(implementations.map(row => [row.id,row]));
    const prerequisites = new Map<string,Parameters<typeof deriveReadiness>[0]>();
    for (const {ownerId,...fact} of dependencies) prerequisites.set(ownerId,[...(prerequisites.get(ownerId) ?? []),fact]);
    for (const value of values) {
      const implementation=latest.get(value.id)!;
      result.set(value.id,{readiness:deriveReadiness(prerequisites.get(value.id) ?? []),evidence:{currentArtifact:currentArtifacts.get(value.id) ?? null,review:gates.get(value.id+":review")!,verification:gates.get(value.id+":verification")!,implementationCurrent:implementation.state === null || implementation.state === "succeeded" && implementation.work_revision === value.workRevision}});
    }
    return result;
  }
  private readiness(id: string) {
    return this.acceptanceSnapshots([task.parse(this.one("tasks",id))]).get(id)!.readiness;
  }
  private evidence(value: z.infer<typeof task>) {
    return this.acceptanceSnapshots([value]).get(value.id)!.evidence;
  }
  private artifact(value: z.infer<typeof task>, artifactRef: string, displayUrl: string | undefined, runId: string | null, actor: "operator" | "reporter", now: number) {
    const fact = { id:randomUUID(), taskId:value.id, runId, workRevision:value.workRevision, artifactRef, reworkRound:value.reworkRound, displayUrl:displayUrl ?? null, actor, createdAt:new Date(now).toISOString() };
    this.insert("task_artifacts",fact);
    this.change("task",value.id,value.projectId,"artifact_published",now);
    return fact;
  }
  command(
    command: ApplicationCommand,
    context: CommandContext,
  ): CommittedReply {
    if(command.kind==="usage.price.create")return new UsageData(this.db).createPriceSnapshot(command.input,context);
    if(command.kind==="retention.preview")return new HistoryData(this.db).preview(command.input,context);
    if(command.kind==="retention.prune")throw new Conflict("retention_coordinator_required");
    if(command.kind==="github.repositories")return new GithubData(this.db).repositories(command.input,context);
    if(command.kind==="github.refresh")throw new Conflict("github_coordinator_required");
    return this.db
      .transaction(() => {
        const { principal, method, path, key, digest, now } = context;
        if (
          [
            "task.dependencies",
            "task.review-policy",
            "task.artifact",
            "task.rework",
            "task.complete",
            "task.reopen",
            "settings.patch",
            "run.close",
            "workflow.run.close",
          ].includes(command.kind) &&
          principal !== "operator"
        )
          throw new Conflict("human_required");
        if (command.kind === "run.event") return this.event(command, context);
        if (command.kind === "workflow.run.event") return this.workflowEvent(command, context);
        const receipt = this.db
          .prepare(
            "SELECT digest,status,body FROM receipts WHERE principal=? AND method=? AND path=? AND key=?",
          )
          .get(principal, method, path, key) as
          | { digest: string; status: number; body: string }
          | undefined;
        if (receipt) {
          if (receipt.digest !== digest)
            throw new Conflict("idempotency_conflict");
          return {
            status: receipt.status,
            body: JSON.parse(receipt.body) as SnapshotBody,
          };
        }
        const time = new Date(now).toISOString();
        let data: unknown;
        let status = 200;
        if (command.kind === "task.dependencies" || command.kind === "task.review-policy" || command.kind === "task.artifact" || command.kind === "task.rework") {
          const value = task.parse(this.one("tasks",command.id));
          this.activeProject(value.projectId);
          if (value.version !== command.input.expectedVersion) throw new Conflict("version_conflict",value.version);
          if (this.facts(value,[]).activeRun) throw new Conflict("active_run");
          if (value.status === "completed") throw new Conflict("task_completed");
          let next = {...value, version:value.version+1, updatedAt:time};
          if (command.kind === "task.dependencies") {
            const prerequisites = command.input.prerequisiteIds.map(id => task.parse(this.one("tasks",id)));
            const ids = prerequisites.map(prerequisite => prerequisite.id);
            if (new Set(ids).size !== ids.length) throw new Conflict("dependency_duplicate");
            for (const prerequisite of prerequisites) {
              if (prerequisite.id === value.id) throw new Conflict("dependency_self");
              if (prerequisite.projectId !== value.projectId) throw new Conflict("dependency_project_mismatch");
              this.activeProject(prerequisite.projectId);
            }
            const edges = this.db.prepare("SELECT task_id,prerequisite_id FROM task_dependencies WHERE project_id=? AND task_id<>?").all(value.projectId,value.id) as {task_id:string;prerequisite_id:string}[];
            validateDependencies([...edges.map(row => [row.task_id,row.prerequisite_id] as const),...ids.map(id => [value.id,id] as const)]);
            this.db.prepare("DELETE FROM task_dependencies WHERE task_id=?").run(value.id);
            for (const id of ids) this.db.prepare("INSERT INTO task_dependencies VALUES(?,?,?)").run(value.id,id,value.projectId);
          } else if (command.kind === "task.review-policy") {
            next = {...next,reviewRequired:command.input.reviewRequired,verificationRequired:command.input.verificationRequired};
          } else if (command.kind === "task.rework") {
            if (value.status !== "review") throw new Conflict("task_not_review");
            next = {...next,status:"backlog",workRevision:value.workRevision+1,reworkRound:value.reworkRound+1};
            this.insert("task_reworks",{id:randomUUID(),taskId:value.id,workRevision:next.workRevision,reworkRound:next.reworkRound,reason:command.input.reason,actor:"operator",createdAt:time});
          } else {
            const current = this.evidence(value).currentArtifact;
            if (current && current.artifactRef !== command.input.artifactRef) next = {...next,workRevision:value.workRevision+1};
            if (!current || current.artifactRef !== command.input.artifactRef) {
              const latest = this.facts(value,[]).latestImplementation;
              if (!current && latest && (latest.state !== "succeeded" || latest.workRevision !== value.workRevision)) throw new Conflict("implementation_not_current");
              this.artifact(next,command.input.artifactRef,command.input.displayUrl,null,"operator",now);
            }
          }
          this.update("tasks",next);
          this.change("task",value.id,value.projectId,command.kind,now);
          data = next;
        } else if (command.kind === "workflow.run.register") {
          const requested = command.input;
          const existing = this.find("workflow_runs", requested.id);
          if (existing) {
            const identity = this.db.prepare("SELECT digest,body FROM workflow_run_registrations WHERE run_id=?").get(existing.id) as { digest: string; body: string };
            if (identity.digest !== digest) throw new Conflict("run_conflict");
            const body = JSON.parse(identity.body) as SnapshotBody;
            this.receipt(context, 200, body);
            return { status: 200, body };
          }
          const workflow = workflows.workflow.parse(this.one("workflows", requested.workflowId));
          this.activeProject(workflow.projectId);
          const revision = this.workflowRevision(requested.planRevisionId);
          if (revision.workflowId !== workflow.id) throw new Conflict("workflow_revision_mismatch");
          if (this.db.prepare("SELECT 1 FROM workflow_runs WHERE workflow_id=? AND state IN ('queued','running')").get(workflow.id)) throw new Conflict("active_run");
          const registrationOrder = nextWorkflowRegistrationOrder(this.db);
          const value: workflows.WorkflowRunFacts = { id: requested.id, workflowId: workflow.id, planRevisionId: revision.id, projectId: workflow.projectId, state: "queued", version: 1, lastSequence: 0, lastReceivedAt: time, createdAt: time, startedAt: null, endedAt: null };
          this.insert("workflow_runs", { ...value, registrationOrder });
          this.change("workflowRun", value.id, value.projectId, "registered", now);
          data = { ...value, freshness: workflowFreshness(value, now) };
          this.db.prepare("INSERT INTO workflow_run_registrations VALUES(?,?,?)").run(value.id, digest, JSON.stringify(this.body(data)));
          status = 201;
        } else if (command.kind === "workflow.run.close") {
          const value = this.workflowRun(command.id);
          if (value.version !== command.input.expectedVersion) throw new Conflict("version_conflict", value.version);
          if (value.state !== "queued" && value.state !== "running") throw new Conflict("run_terminal");
          if (!workflowFreshness(value, now).stale) throw new Conflict("run_not_stale");
          const next = { ...value, state: "interrupted" as const, version: value.version + 1, endedAt: time };
          this.update("workflow_runs", next);
          this.insert("workflow_closures", { id: randomUUID(), workflowRunId: value.id, reason: command.input.reason, actor: "operator", createdAt: time });
          this.change("workflowRun", value.id, value.projectId, "closed", now);
          data = { ...next, freshness: workflowFreshness(next, now) };
        } else if (command.kind === "workflow.create") {
          const existing = this.find("workflows", command.input.id);
          if (existing) {
            const identity = this.db.prepare("SELECT digest,body FROM workflow_identities WHERE workflow_id=?").get(existing.id) as { digest: string; body: string };
            if (identity.digest !== digest) throw new Conflict("workflow_conflict");
            const body = JSON.parse(identity.body) as SnapshotBody;
            this.receipt(context, 200, body);
            return { status: 200, body };
          }
          const projectValue = this.activeProject(command.input.projectId);
          data = { ...command.input, projectId: projectValue.id, version: 1, createdAt: time };
          this.insert("workflows", data as Row);
          this.change("workflow", command.input.id, projectValue.id, "created", now);
          status = 201;
          this.db.prepare("INSERT INTO workflow_identities VALUES(?,?,?)").run(command.input.id, digest, JSON.stringify(this.body(data)));
        } else if (command.kind === "workflow.revision") {
          const existing = this.find("workflow_revisions", command.input.id);
          if (existing) {
            if (existing.workflow_id !== command.id || existing.digest !== digest) throw new Conflict("workflow_revision_conflict");
            const body = JSON.parse(existing.body as string) as SnapshotBody;
            this.receipt(context, 200, body);
            return { status: 200, body };
          }
          const value = workflows.workflow.parse(this.one("workflows", command.id));
          this.activeProject(value.projectId);
          if (value.version !== command.input.expectedWorkflowVersion) throw new Conflict("version_conflict", value.version);
          validateWorkflowPlan({ nodes: command.input.nodes, edges: command.input.edges });
          for (const node of command.input.nodes) if (node.taskId) {
            const linked = task.parse(this.one("tasks", node.taskId));
            if (linked.projectId !== value.projectId) throw new Conflict("task_project_mismatch");
          }
          const last = this.db.prepare("SELECT coalesce(max(revision),0) AS revision FROM workflow_revisions WHERE workflow_id=?").get(value.id) as { revision: number };
          const revision = { id: command.input.id, workflowId: value.id, revision: last.revision + 1, nodes: command.input.nodes, edges: command.input.edges, createdAt: time };
          data = { id: revision.id, workflowId: revision.workflowId, revision: revision.revision, createdAt: revision.createdAt };
          this.update("workflows", { ...value, version: value.version + 1 });
          this.change("workflow", value.id, value.projectId, "revision_published", now);
          this.insert("workflow_revisions", { ...revision, digest, body: JSON.stringify(this.body(data)) });
          status = 201;
        } else if (command.kind === "agent.create") {
          const id = command.input.id?.toLowerCase() ?? randomUUID();
          if (this.find("agents", id)) throw new Conflict("agent_conflict");
          const value = { ...command.input, id, version: 1, createdAt: time };
          this.insert("agents", value);
          this.change("agent", id, null, "created", now);
          data = this.agentView(value, now);
          status = 201;
        } else if (command.kind === "agent.patch") {
          const value = this.one("agents", command.id);
          if (value.version !== command.input.expectedVersion)
            throw new Conflict("version_conflict", value.version as number);
          const { expectedVersion, ...patch } = command.input;
          void expectedVersion;
          const next = {
            ...value,
            ...patch,
            version: (value.version as number) + 1,
          };
          this.update("agents", next);
          this.change("agent", value.id as string, null, "updated", now);
          data = this.agentView(next, now);
        } else if (command.kind === "run.register") {
          const requested = command.input;
          const existing = this.find("runs", requested.id);
          if (existing) {
            const identity = this.db
              .prepare(
                "SELECT digest,body FROM run_registrations WHERE run_id=?",
              )
              .get(existing.id) as { digest: string; body: string } | undefined;
            if (!identity || identity.digest !== digest)
              throw new Conflict("run_conflict");
            const body = JSON.parse(identity.body) as SnapshotBody;
            this.receipt(context, 200, body);
            return { status: 200, body };
          }
          const projectValue = this.activeProject(requested.projectId);
          const agentValue = this.one("agents", requested.agentId);
          const taskValue = requested.taskId
            ? task.parse(this.one("tasks", requested.taskId))
            : null;
          const input = {
            ...requested,
            id: requested.id.toLowerCase(),
            projectId: projectValue.id,
            agentId: agentValue.id as string,
            ...(taskValue ? { taskId: taskValue.id } : {}),
          };
          const active = !!this.db
            .prepare(
              "SELECT 1 FROM runs WHERE task_id=? AND state IN ('queued','running')",
            )
            .get(input.taskId ?? null);
          const nextTask = decideRegistration(input, taskValue, active, now);
          if (taskValue && input.purpose === "implementation") {
            const readiness = this.readiness(taskValue.id);
            if (!readiness.ready) throw new Conflict("dependencies_not_ready",undefined,{blockedPrerequisiteIds:readiness.blockedPrerequisiteIds,prerequisites:readiness.prerequisites});
          }
          let captured: evidence.ReviewTuple | null = null;
          if (taskValue && (input.purpose === "review" || input.purpose === "verification")) {
            const required = input.purpose === "review" ? taskValue.reviewRequired : taskValue.verificationRequired;
            const current = this.evidence(taskValue).currentArtifact;
            if (input.artifactRef !== undefined) {
              const requestedTuple = evidence.reviewTuple.parse({workRevision:input.workRevision,artifactRef:input.artifactRef,reworkRound:input.reworkRound});
              if (!sameTuple(requestedTuple,current)) throw new Conflict("review_tuple_obsolete");
              captured = current;
            } else if (required) throw new Conflict("review_tuple_required");
          }
          if (nextTask) {
            this.update("tasks", nextTask);
            this.change(
              "task",
              nextTask.id,
              input.projectId,
              "run_registered",
              now,
            );
          }
          const value: Run = {
            id: input.id,
            projectId: input.projectId,
            agentId: input.agentId,
            taskId: input.taskId ?? null,
            purpose: input.purpose,
            model: input.model ?? null,
            workRevision: nextTask?.workRevision ?? null,
            artifactRef: captured?.artifactRef ?? null,
            reworkRound: captured?.reworkRound ?? null,
            state: "queued",
            lastSequence: 0,
            lastReceivedAt: time,
            startedAt: null,
            endedAt: null,
            version: 1,
            createdAt: time,
          };
          this.insert("runs", {
            ...value,
            registrationOrder: nextRegistrationOrder(this.db),
          });
          this.change("run", value.id, value.projectId, "registered", now);
          data = this.runView(value, now);
          status = 201;
          const original = this.body(data);
          this.db
            .prepare("INSERT INTO run_registrations VALUES(?,?,?)")
            .run(value.id, digest, JSON.stringify(original));
        } else if (command.kind === "run.close") {
          const value = this.run(command.id);
          const next = decideClose(value, command.input.expectedVersion, now);
          this.update("runs", next);
          this.insert("run_closures", {
            id: randomUUID(),
            runId: value.id,
            reason: command.input.reason,
            actor: "operator",
            createdAt: time,
          });
          this.change("run", value.id, value.projectId, "closed", now);
          data = this.runView(next, now);
        } else if (command.kind === "project.create") {
          data = {
            id: randomUUID(),
            name: command.input.name,
            repositoryPath: command.input.repositoryPath ?? null,
            archivedAt: null,
            version: 1,
            createdAt: time,
            updatedAt: time,
          };
          this.insert("projects", data as Row);
          this.change(
            "project",
            (data as Row).id as string,
            (data as Row).id as string,
            "created",
            now,
          );
          status = 201;
        } else if (command.kind === "project.patch") {
          const value = project.parse(this.one("projects", command.id));
          if (value.version !== command.input.expectedVersion)
            throw new Conflict("version_conflict", value.version);
          if (
            command.input.archived &&
            (this.db.prepare("SELECT 1 FROM runs WHERE project_id=? AND state IN ('queued','running') LIMIT 1").get(value.id) || this.db.prepare("SELECT 1 FROM workflow_runs WHERE project_id=? AND state IN ('queued','running') LIMIT 1").get(value.id))
          )
            throw new Conflict("active_run");
          data = {
            ...value,
            name: command.input.name ?? value.name,
            repositoryPath:
              command.input.repositoryPath === undefined
                ? value.repositoryPath
                : command.input.repositoryPath,
            archivedAt:
              command.input.archived === undefined
                ? value.archivedAt
                : command.input.archived
                  ? (value.archivedAt ?? time)
                  : null,
            version: value.version + 1,
            updatedAt: time,
          };
          this.update("projects", data as Row);
          this.change("project", value.id, value.id, "updated", now);
        } else if (command.kind === "task.create") {
          const resolved = {
            ...command.input,
            projectId: this.activeProject(command.input.projectId).id,
            ...(command.input.assignedAgentId !== undefined
              ? {
                  assignedAgentId: this.reference(
                    "agents",
                    command.input.assignedAgentId,
                  ),
                }
              : {}),
            ...(command.input.parentTaskId !== undefined
              ? {
                  parentTaskId: this.reference(
                    "tasks",
                    command.input.parentTaskId,
                  ),
                }
              : {}),
          };
          this.references(
            resolved.projectId,
            resolved.parentTaskId,
            resolved.assignedAgentId,
          );
          data = {
            description: "",
            acceptanceCriteria: "",
            priority: "normal",
            tags: [],
            assignedAgentId: null,
            targetRole: null,
            parentTaskId: null,
            branch: null,
            pullRequestUrl: null,
            blockedReason: null,
            ...resolved,
            id: randomUUID(),
            status: "backlog",
            version: 1,
            workRevision: 1,
            reviewRequired: false,
            verificationRequired: false,
            reworkRound: 0,
            createdAt: time,
            updatedAt: time,
            completedAt: null,
          };
          this.insert("tasks", data as Row);
          this.change(
            "task",
            (data as Row).id as string,
            resolved.projectId,
            "created",
            now,
          );
          status = 201;
        } else if (command.kind === "settings.patch") {
          const value = this.db
            .prepare("SELECT timezone,version FROM settings WHERE singleton=1")
            .get() as { timezone: string; version: number };
          if (value.version !== command.input.expectedVersion)
            throw new Conflict("version_conflict", value.version);
          this.db
            .prepare(
              "UPDATE settings SET timezone=?,version=version+1 WHERE singleton=1",
            )
            .run(command.input.timezone);
          this.change("settings", "settings", null, "updated", now);
          data = this.settings();
        } else {
          const value = task.parse(this.one("tasks", command.id));
          let input: TaskCommand;
          if (command.kind === "task.patch") {
            const { expectedVersion, ...requestedChanges } = command.input;
            const changes = {
              ...requestedChanges,
              ...(requestedChanges.assignedAgentId !== undefined
                ? {
                    assignedAgentId: this.reference(
                      "agents",
                      requestedChanges.assignedAgentId,
                    ),
                  }
                : {}),
              ...(requestedChanges.parentTaskId !== undefined
                ? {
                    parentTaskId: this.reference(
                      "tasks",
                      requestedChanges.parentTaskId,
                    ),
                  }
                : {}),
            };
            input = { kind: "patch", expectedVersion, changes };
          } else if (command.kind === "task.complete")
            input = { kind: "complete", ...command.input };
          else if (command.kind === "task.reopen")
            input = { kind: "reopen", ...command.input };
          else input = { kind: "comment", ...command.input };
          const ancestors =
            input.kind === "patch"
              ? this.references(
                  value.projectId,
                  input.changes.parentTaskId,
                  input.changes.assignedAgentId,
                )
              : [];
          const decision = decideTask(
            value,
            input,
            this.facts(value, ancestors),
            principal,
            now,
          );
          if (input.kind !== "comment") this.update("tasks", decision.task);
          if (input.kind === "complete") {
            data = {
              id: randomUUID(),
              taskId: value.id,
              workRevision: value.workRevision,
              implementationRunId: decision.implementationRunId ?? null,
              actor: "operator",
              evidenceNote: input.evidenceNote,
              evidenceUrl: input.evidenceUrl ?? null,
              acceptedAt: time,
            };
            this.insert("completions", data as Row);
            this.change(
              "completion",
              (data as Row).id as string,
              value.projectId,
              "created",
              now,
            );
            status = 201;
          } else if (input.kind === "comment") {
            data = {
              id: randomUUID(),
              taskId: value.id,
              text: input.text,
              actor: principal,
              createdAt: time,
            };
            this.insert("comments", data as Row);
            this.change(
              "comment",
              (data as Row).id as string,
              value.projectId,
              "created",
              now,
            );
            status = 201;
          } else if (input.kind === "reopen") {
            const fact = {
              id: randomUUID(),
              taskId: value.id,
              workRevision: decision.task.workRevision,
              actor: "operator",
              reason: input.reason,
              createdAt: time,
            };
            this.insert("reopens", fact);
            this.change("reopen", fact.id, value.projectId, "created", now);
            data = decision.task;
          } else data = decision.task;
          this.change("task", value.id, value.projectId, input.kind, now);
        }
        const body = this.body(data);
        this.db
          .prepare("INSERT INTO receipts VALUES(?,?,?,?,?,?,?)")
          .run(
            principal,
            method,
            path,
            key,
            digest,
            status,
            JSON.stringify(body),
          );
        return { status, body };
      })
      .immediate();
  }
  private receipt(context: CommandContext, status: number, body: SnapshotBody) {
    this.db
      .prepare("INSERT INTO receipts VALUES(?,?,?,?,?,?,?)")
      .run(
        context.principal,
        context.method,
        context.path,
        context.key,
        context.digest,
        status,
        JSON.stringify(body),
      );
  }
  private run(id: string): Run {
    const value = this.one("runs", id);
    delete value.registrationOrder;
    return run.parse(value);
  }
  private runView(value: Run, now: number) {
    return { ...value, freshness: observationFreshness(value, now) };
  }
  private agentView(value: Row, now: number) {
    const { reporting: reported, ...identity } = value;
    return {
      ...identity,
      reporting:
        reported === undefined
          ? !!this.db
              .prepare(
                "SELECT 1 FROM runs WHERE agent_id=? AND state='running' AND last_received_at>=? LIMIT 1",
              )
              .get(value.id, now - 60000)
          : !!reported,
      queuedRunsUrl: `/api/v1/runs?agentId=${value.id}&state=queued`,
      activeRunsUrl: `/api/v1/runs?agentId=${value.id}&state=running`,
      historyUrl: `/api/v1/runs?agentId=${value.id}`,
    };
  }
  private event(
    command: Extract<ApplicationCommand, { kind: "run.event" }>,
    context: CommandContext,
  ): CommittedReply {
    const { id } = command;
    const input = {
      ...command.input,
      eventId: command.input.eventId.toLowerCase(),
      runId: command.input.runId.toLowerCase(),
    };
    if (input.runId !== id.toLowerCase())
      throw new Conflict("validation_failed");
    const existing = this.find("run_events", input.eventId, "event_id") as
      | { digest: string; acknowledgement: string }
      | undefined;
    if (existing) {
      if (existing.digest !== context.digest)
        throw new Conflict("idempotency_conflict");
      return {
        status: 200,
        body: JSON.parse(existing.acknowledgement) as SnapshotBody,
      };
    }
    if (this.find("workflow_events", input.eventId, "event_id")) throw new Conflict("idempotency_conflict");
    const value = this.run(id);
    const taskValue = value.taskId
      ? task.parse(this.one("tasks", value.taskId))
      : null;
    const decision = decideEvent(value, input, taskValue, context.now);
    if (input.type === "run.succeeded") {
      const payload = input.payload;
      if (payload.artifactRef !== undefined && value.purpose !== "implementation") throw new Conflict("artifact_purpose_invalid");
      if (payload.decision !== undefined && !["review","verification"].includes(value.purpose)) throw new Conflict("decision_purpose_invalid");
      const required = taskValue && (value.purpose === "review" ? taskValue.reviewRequired : value.purpose === "verification" ? taskValue.verificationRequired : false);
      if (required && payload.decision === undefined) throw new Conflict("decision_required");
      if (required || payload.decision !== undefined) {
        const tuple = value.artifactRef !== null && value.workRevision !== null && value.reworkRound !== null ? {workRevision:value.workRevision,artifactRef:value.artifactRef,reworkRound:value.reworkRound} : null;
        if (!taskValue || !sameTuple(tuple,this.evidence(taskValue).currentArtifact)) throw new Conflict("review_tuple_obsolete");
      }
    }
    this.update("runs", decision.run);
    if (decision.task) {
      this.update("tasks", decision.task);
      this.change(
        "task",
        decision.task.id,
        value.projectId,
        input.type,
        context.now,
      );
    }
    this.change("run", value.id, value.projectId, input.type, context.now);
    this.change(
      "event",
      input.eventId,
      value.projectId,
      "accepted",
      context.now,
    );
    const receivedAt = new Date(context.now).toISOString();
    const body = this.body({
      eventId: input.eventId,
      runId: value.id,
      acceptedSequence: input.sequence,
      receivedAt,
    });
    this.db
      .prepare("INSERT INTO run_events(event_id,run_id,sequence,type,digest,body,acknowledgement,occurred_at,received_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        input.eventId,
        value.id,
        input.sequence,
        input.type,
        context.digest,
        JSON.stringify({ ...input, runId: value.id, receivedAt }),
        JSON.stringify(body),
        Date.parse(input.occurredAt),
        context.now,
      );
    if (input.type === "run.usage") new UsageData(this.db).accept(value.id,input.eventId,input.payload,context.now);
    if (input.type === "run.succeeded" && taskValue) {
      if (input.payload.artifactRef !== undefined) this.artifact(taskValue,input.payload.artifactRef,input.payload.displayUrl,value.id,"reporter",context.now);
      if (input.payload.decision !== undefined) {
        this.insert("gate_decisions",{id:randomUUID(),taskId:taskValue.id,runId:value.id,eventId:input.eventId,workRevision:value.workRevision,artifactRef:value.artifactRef,reworkRound:value.reworkRound,purpose:value.purpose,decision:input.payload.decision,evidenceNote:input.payload.evidenceNote,createdAt:receivedAt});
        this.change("task",taskValue.id,taskValue.projectId,"gate_decision",context.now);
      }
    }
    return { status: 201, body };
  }
  private workflowRevision(id: string) {
    const { digest, body, ...value } = this.one("workflow_revisions", id);
    void digest; void body;
    return workflows.planRevision.parse(value);
  }
  private workflowRun(id: string) {
    const { registrationOrder, ...value } = this.one("workflow_runs", id);
    void registrationOrder;
    return workflows.workflowRun.parse(value);
  }
  private workflowRunDetail(id: string, now: number) {
    const value = this.workflowRun(id);
    const revision = this.workflowRevision(value.planRevisionId);
    const rows = this.db.prepare("SELECT body,node_id FROM workflow_node_observations AS n WHERE workflow_run_id=? AND sequence=(SELECT max(sequence) FROM workflow_node_observations WHERE workflow_run_id=n.workflow_run_id AND node_id=n.node_id)").all(value.id) as { body: string; node_id: string }[];
    const latest = new Map<string, z.infer<typeof workflows.nodeObservation>>();
    for (const row of rows) if (!latest.has(row.node_id)) latest.set(row.node_id, workflows.nodeObservation.parse(JSON.parse(row.body)));
    const closure = this.db.prepare("SELECT reason,actor,created_at FROM workflow_closures WHERE workflow_run_id=?").get(value.id) as Row | undefined;
    return { ...value, freshness: workflowFreshness(value, now), closure: closure ? serialize(closure) : null, nodes: revision.nodes.map(node => {
      const observation = latest.get(node.id) ?? null;
      const linked = observation?.payload.runId;
      return { nodeId: node.id, label: node.label, taskId: node.taskId ?? null, observation, linkedAttempt: linked ? this.runView(this.run(linked), now) : null };
    }) };
  }
  private workflowEvent(command: Extract<ApplicationCommand, { kind: "workflow.run.event" }>, context: CommandContext): CommittedReply {
    const input = command.input;
    if (input.workflowRunId !== command.id.toLowerCase()) throw new Conflict("validation_failed");
    const existing = this.find("workflow_events", input.eventId, "event_id");
    if (existing) {
      if (existing.digest !== context.digest) throw new Conflict("idempotency_conflict");
      return { status: 200, body: JSON.parse(existing.acknowledgement as string) as SnapshotBody };
    }
    if (this.find("run_events", input.eventId, "event_id")) throw new Conflict("idempotency_conflict");
    const value = this.workflowRun(command.id);
    const next = decideWorkflowEvent(value, input, context.now);
    let linkedRunId: string | null = null;
    if (input.type === "workflow.node.reported") {
      const revision = this.workflowRevision(value.planRevisionId);
      const node = revision.nodes.find(n => n.id === input.payload.nodeId);
      if (!node) throw new Conflict("workflow_node_unknown");
      if (input.payload.runId) {
        const linked = this.run(input.payload.runId);
        linkedRunId = linked.id;
        if (!node.taskId || linked.taskId?.toLowerCase() !== node.taskId.toLowerCase() || linked.projectId.toLowerCase() !== value.projectId.toLowerCase()) throw new Conflict("workflow_run_link_mismatch");
      }
    }
    this.update("workflow_runs", next);
    this.change("workflowRun", value.id, value.projectId, input.type, context.now);
    this.change("workflowEvent", input.eventId, value.projectId, "accepted", context.now);
    const receivedAt = new Date(context.now).toISOString();
    const body = this.body({ eventId: input.eventId, workflowRunId: value.id, acceptedSequence: input.sequence, receivedAt });
    const record = JSON.stringify({ ...input, receivedAt });
    this.db.prepare("INSERT INTO workflow_events VALUES(?,?,?,?,?,?,?,?,?)").run(input.eventId, value.id, input.sequence, input.type, context.digest, record, JSON.stringify(body), Date.parse(input.occurredAt), context.now);
    if (input.type === "workflow.node.reported") this.insert("workflow_node_observations", { id: input.eventId, workflowRunId: value.id, nodeId: input.payload.nodeId, runId: linkedRunId, sequence: input.sequence, createdAt: receivedAt, body: record });
    return { status: 201, body };
  }
  private settings() {
    const value = this.db
      .prepare("SELECT timezone,version FROM settings WHERE singleton=1")
      .get() as { timezone: string; version: number };
    let storageBytes = 0;
    for (const suffix of ["", "-wal"]) {
      try {
        storageBytes += statSync(
          join(this.dataDir, "agentflow.sqlite" + suffix),
        ).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return {
      ...value,
      dataLocation: this.dataDir,
      storageBytes,
      storageMeasurement: "observational",
    };
  }
  private page(
    source: string,
    where: string,
    params: unknown[],
    kind: string,
    filters: unknown,
    limit: number,
    cursor?: string,
    timeColumn = "created_at",
    ascending = false,
  ) {
    const generation = this.body(null).generation;
    const fingerprint = canonicalDigest({
      kind,
      filters,
      limit,
      order: timeColumn + (ascending ? "-id-asc" : "-id-desc"),
    });
    let boundary = "";
    const boundParams: unknown[] = [];
    if (cursor) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > 4096)
          throw new Error("shape");
        const parsed = z
          .strictObject({
            v: z.literal(1),
            generation: z.uuid(),
            fingerprint: z.string().length(64),
            time: z.number().int().safe(),
            id: z.string().min(1).max(100),
          })
          .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
        if (
          parsed.generation !== generation ||
          parsed.fingerprint !== fingerprint
        )
          throw new Error("binding");
        const comparison = ascending ? ">" : "<";
        boundary = ` AND (${timeColumn}${comparison}? OR (${timeColumn}=? AND id${comparison}?))`;
        boundParams.push(parsed.time, parsed.time, parsed.id);
      } catch {
        throw new Conflict("cursor_invalid");
      }
    }
    const total = (
      this.db
        .prepare(`SELECT count(*) AS total FROM ${source} WHERE ${where}`)
        .get(...params) as { total: number }
    ).total;
    const rows = this.db
      .prepare(
        `SELECT * FROM ${source} WHERE (${where})${boundary} ORDER BY ${timeColumn} ${ascending ? "ASC" : "DESC"},id ${ascending ? "ASC" : "DESC"} LIMIT ?`,
      )
      .all(...params, ...boundParams, limit + 1) as Row[];
    const more = rows.length > limit;
    const selected = rows.slice(0, limit);
    const last = selected.at(-1);
    const nextCursor =
      more && last
        ? Buffer.from(
            JSON.stringify({
              v: 1,
              generation,
              fingerprint,
              time: last[timeColumn],
              id: last.id,
            }),
          ).toString("base64url")
        : null;
    return { items: selected.map(serialize), total, nextCursor };
  }
  private taskList(input: z.infer<typeof taskQuery>) {
    const { cursor, limit, ...filters } = input;
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of [
      ["projectId", "project_id"],
      ["status", "status"],
      ["priority", "priority"],
      ["assignedAgentId", "assigned_agent_id"],
    ] as const) {
      if (filters[key] !== undefined) {
        clauses.push(column + "=?");
        const resolvedFilter = column.endsWith("_id")
          ? (this.find(
              (
                {
                  projectId: "projects",
                  taskId: "tasks",
                  assignedAgentId: "agents",
                  agentId: "agents",
                } as Record<string, string>
              )[key],
              filters[key] as string,
            )?.id ?? filters[key])
          : filters[key];
        params.push(resolvedFilter);
        if (column.endsWith("_id"))
          Object.assign(filters, { [key]: resolvedFilter });
      }
    }
    if (filters.tag) {
      clauses.push(
        "EXISTS (SELECT 1 FROM json_each(tasks.tags) WHERE value=?)",
      );
      params.push(filters.tag);
    }
    if (filters.q) {
      clauses.push("instr(lower(title),lower(?))>0");
      params.push(filters.q);
    }
    const page = this.page(
      "tasks",
      clauses.join(" AND ") || "1",
      params,
      "tasks",
      filters,
      limit,
      cursor,
    );
    const summaries=this.acceptanceSnapshots(page.items.map(value=>task.parse(value)));
    return {...page,items:page.items.map(value=>({...value,...summaries.get(value.id as string)!}))};
  }
  private history(
    id: string,
    kind: "completion" | "reopen",
    limit: number,
    cursor?: string,
  ) {
    const result = this.page(
      kind === "completion" ? "completions" : "reopens",
      "task_id=?",
      [id],
      kind,
      { taskId: id },
      limit,
      cursor,
      kind === "completion" ? "accepted_at" : "created_at",
    );
    const nextUrl = result.nextCursor
      ? `/api/v1/tasks/${id}?history=${kind}&historyLimit=${limit}&${kind}Cursor=${result.nextCursor}`
      : null;
    return { items: result.items, nextCursor: result.nextCursor, nextUrl };
  }
  private overview(
    input: { timezone?: string; limit: number; cursor?: string },
    now: number,
  ) {
    const settings = this.settings();
    const zone = input.timezone ?? (settings.timezone as string);
    const day = localDayInterval(localDate(now, zone), zone);
    const count = (sql: string, ...params: unknown[]) =>
      (this.db.prepare(sql).get(...params) as { count: number }).count;
    const metrics = {
      activeProjects: count(
        "SELECT count(*) AS count FROM projects WHERE archived_at IS NULL",
      ),
      reportingAgents: count(
        "SELECT count(DISTINCT agent_id) AS count FROM runs r JOIN projects p ON p.id=r.project_id WHERE p.archived_at IS NULL AND r.state='running' AND r.last_received_at>=?",
        now - 60000,
      ),
      completedToday: count(
        "SELECT count(*) AS count FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.archived_at IS NULL AND t.status='completed' AND t.completed_at>=? AND t.completed_at<?",
        day.start,
        day.end,
      ),
      awaitingReview: count(
        "SELECT count(*) AS count FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.archived_at IS NULL AND t.status='review'",
      ),
      failedRunsToday: count(
        "SELECT count(*) AS count FROM runs r JOIN projects p ON p.id=r.project_id WHERE p.archived_at IS NULL AND r.state='failed' AND r.ended_at>=? AND r.ended_at<?",
        day.start,
        day.end,
      ),
    };
    const source = `(SELECT t.id,t.project_id,t.id AS task_id,NULL AS run_id,t.title,t.created_at,
 (CASE WHEN trim(coalesce(t.blocked_reason,''))<>'' THEN 1 ELSE 0 END) AS blocked,
 EXISTS(SELECT 1 FROM runs r WHERE r.task_id=t.id AND r.state='failed') AS failed,
 EXISTS(SELECT 1 FROM runs r WHERE r.task_id=t.id AND r.state IN ('queued','running') AND r.last_received_at<?) AS stale
 FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.archived_at IS NULL
 UNION ALL SELECT r.id,r.project_id,NULL,r.id,coalesce(r.model,'Planning run'),r.created_at,0,r.state='failed',r.state IN ('queued','running') AND r.last_received_at<?
 FROM runs r JOIN projects p ON p.id=r.project_id WHERE r.task_id IS NULL AND p.archived_at IS NULL)`;
    const attention = this.page(
      source,
      "blocked OR failed OR stale",
      [now - 60000, now - 60000],
      "attention",
      { timezone: zone, day: localDate(now, zone) },
      input.limit,
      input.cursor,
    );
    return {
      metrics,
      attention: {
        ...attention,
        items: attention.items.map(({ blocked, failed, stale, ...item }) => ({
          ...item,
          reasons: [
            ...(blocked ? ["blocked"] : []),
            ...(failed ? ["failed"] : []),
            ...(stale ? ["stale"] : []),
          ],
        })),
      },
      timezone: zone,
      capturedAt: new Date(now).toISOString(),
      day: {
        start: new Date(day.start).toISOString(),
        end: new Date(day.end).toISOString(),
      },
    };
  }
  private eventView(body:string,prunedAt:string|null) {
    const event=JSON.parse(body);
    return prunedAt ? {...event,payload:null,payloadPrunedAt:prunedAt} : event;
  }
  private joinedRuns(where = "1", params: unknown[] = []) {
    return this.db.prepare(`SELECT r.*,a.display_name AS agent_name,a.source AS agent_source,p.name AS project_name,t.title AS task_title,
      (SELECT body FROM run_events e WHERE e.run_id=r.id AND e.type<>'run.heartbeat' ORDER BY sequence DESC LIMIT 1) AS report_body,
      (SELECT payload_pruned_at FROM run_events e WHERE e.run_id=r.id AND e.type<>'run.heartbeat' ORDER BY sequence DESC LIMIT 1) AS report_pruned_at
      FROM runs r JOIN agents a ON a.id=r.agent_id JOIN projects p ON p.id=r.project_id LEFT JOIN tasks t ON t.id=r.task_id WHERE ${where}`).all(...params) as Row[];
  }
  private summary(row: Row, now: number) {
    const value = serialize(row);
    const { registrationOrder, reportBody, reportPrunedAt, agentName, agentSource, projectName, taskTitle, ...record } = value;
    void registrationOrder;
    const report = reportBody ? JSON.parse(reportBody as string) : null;
    return { ...this.runView(run.parse(record), now), agentName, agentSource, projectName, taskTitle,
      message: report?.payload?.message ?? report?.payload?.summary ?? report?.payload?.reason ?? null,
      evidenceUrl: report?.payload?.evidenceUrl ?? null, ...(reportPrunedAt ? {messagePrunedAt:reportPrunedAt} : {}) };
  }
  private trackingTasks(page: { items: Row[]; total: number; nextCursor: string | null }, now: number) {
    const ids = page.items.map(t => t.id);
    const rows = ids.length ? this.joinedRuns(`r.task_id IN (${ids.map(() => "?").join(",")}) AND r.registration_order=(SELECT max(latest.registration_order) FROM runs latest WHERE latest.task_id=r.task_id)`, ids) : [];
    const latest = new Map(rows.map(row => [row.task_id, this.summary(row, now)]));
    return { ...page, items: page.items.map(value => ({ ...value, latestAttempt: latest.get(value.id) ?? null })) };
  }
  private activity(input: z.infer<typeof activityQuery>) {
    const { limit, cursor, ...filters } = input;
    const clauses: string[] = [], params: unknown[] = [];
    for (const [key, table, column] of [["projectId", "projects", "project_id"], ["agentId", "agents", "agent_id"], ["taskId", "tasks", "task_id"]] as const) {
      if (filters[key]) {
        const id = this.find(table, filters[key]!)?.id ?? filters[key];
        Object.assign(filters, { [key]: id }); clauses.push(`${column}=?`); params.push(id);
      }
    }
    const source = `(SELECT 'event:'||e.event_id AS id,'report' AS kind,r.id AS run_id,r.project_id,r.agent_id,r.task_id,a.display_name AS agent_name,a.source AS agent_source,p.name AS project_name,t.title AS task_title,r.purpose,r.model,e.received_at AS created_at,e.occurred_at,e.body AS event_body,e.payload_pruned_at,NULL AS reason
      FROM run_events e JOIN runs r ON r.id=e.run_id JOIN agents a ON a.id=r.agent_id JOIN projects p ON p.id=r.project_id LEFT JOIN tasks t ON t.id=r.task_id WHERE e.type<>'run.heartbeat'
      UNION ALL SELECT 'closure:'||c.id,'tracking_closed',r.id,r.project_id,r.agent_id,r.task_id,a.display_name,a.source,p.name,t.title,r.purpose,r.model,c.created_at,NULL,NULL,NULL,c.reason
      FROM run_closures c JOIN runs r ON r.id=c.run_id JOIN agents a ON a.id=r.agent_id JOIN projects p ON p.id=r.project_id LEFT JOIN tasks t ON t.id=r.task_id)`;
    const page = this.page(source, clauses.join(" AND ") || "1", params, "activity", filters, limit, cursor);
    return { ...page, items: page.items.map(({ createdAt, eventBody, payloadPrunedAt, ...value }) => ({ ...value, receivedAt: createdAt, event: eventBody ? this.eventView(eventBody as string,payloadPrunedAt as string|null) : null })) };
  }
  snapshot(query: ApplicationQuery, now: number): CommittedReply {
    if(query.kind==="github")return new GithubData(this.db).snapshot(query.input,now);
    return this.db.transaction(() => {
      let data: unknown;
      if(query.kind==="usage") data=new UsageData(this.db).snapshot(query.input,now);
      else if(query.kind==="usage.prices") data=new UsageData(this.db).priceSnapshots(query.input);
      else if (query.kind === "workflow.readiness") {
        const workflow=this.one("workflows",query.id), revision=this.workflowRevision(query.revisionId);
        if (revision.workflowId !== workflow.id) throw new Conflict("resource_not_found");
        const ids=[...new Set(revision.nodes.flatMap(node=>node.taskId ? [node.taskId.toLowerCase()] : []))];
        const rows=ids.length ? this.db.prepare(`SELECT * FROM tasks WHERE id COLLATE NOCASE IN (${ids.map(()=>"?").join(",")}) LIMIT 101`).all(...ids) as Row[] : [];
        if (rows.length !== ids.length) throw new Conflict("identity_ambiguous");
        const values=rows.map(row=>task.parse(serialize(row)));
        if (new Set(values.map(value=>value.id.toLowerCase())).size !== values.length) throw new Conflict("identity_ambiguous");
        const summaries=this.acceptanceSnapshots(values);
        data={workflowId:workflow.id,revisionId:revision.id,tasks:values.map(value=>({...value,...summaries.get(value.id)!}))};
      } else if (query.kind === "task.readiness") {
        const value = this.one("tasks",query.id);
        data = this.readiness(value.id as string);
      } else if (query.kind === "task.evidence" || query.kind === "task.decisions" || query.kind === "task.reworks") {
        const value = this.one("tasks",query.id);
        data = this.page(query.kind === "task.evidence" ? "task_artifacts" : query.kind === "task.decisions" ? "gate_decisions" : "task_reworks","task_id=?",[value.id],query.kind,{taskId:value.id},query.input.limit,query.input.cursor);
      } else if (query.kind === "workflow.run.summary") { const value=this.workflowRun(query.id);data={...value,freshness:workflowFreshness(value,now)}; }
      else if (query.kind === "workflow.run") data = this.workflowRunDetail(query.id, now);
      else if (query.kind === "workflow.runs") {
        this.one("workflows", query.input.workflowId);
        if (query.input.planRevisionId && this.workflowRevision(query.input.planRevisionId).workflowId !== query.input.workflowId) throw new Conflict("workflow_revision_mismatch");
        const where = "workflow_id=?" + (query.input.planRevisionId ? " AND plan_revision_id=?" : "");
        const params = [query.input.workflowId, ...(query.input.planRevisionId ? [query.input.planRevisionId] : [])];
        const page = this.page("workflow_runs", where, params, query.kind, { workflowId: query.input.workflowId, planRevisionId: query.input.planRevisionId }, query.input.limit, query.input.cursor, "registration_order");
        data = { ...page, items: page.items.map(({ registrationOrder, ...row }) => { void registrationOrder; const run = workflows.workflowRun.parse(row); return { ...run, freshness: workflowFreshness(run, now) }; }) };
      } else if (query.kind === "workflow.events" || query.kind === "workflow.nodes") {
        const run = this.workflowRun(query.id);
        if (query.kind === "workflow.nodes" && !this.workflowRevision(run.planRevisionId).nodes.some(n => n.id === query.nodeId)) throw new Conflict("resource_not_found");
        const table = query.kind === "workflow.events" ? "(SELECT event_id AS id,* FROM workflow_events)" : "workflow_node_observations";
        const where = "workflow_run_id=?" + (query.kind === "workflow.nodes" ? " AND node_id=?" : "");
        const page = this.page(table, where, [query.id, ...(query.kind === "workflow.nodes" ? [query.nodeId] : [])], query.kind, { workflowRunId: query.id, ...(query.kind === "workflow.nodes" ? { nodeId: query.nodeId } : {}) }, query.input.limit, query.input.cursor, "sequence");
        data = { ...page, items: page.items.map(row => JSON.parse(row.body as string)) };
      } else if (query.kind === "workflow") data = workflows.workflow.parse(this.one("workflows", query.id));
      else if (query.kind === "workflows") {
        const projectId=this.one("projects", query.input.projectId).id;
        data = this.page("workflows", "project_id=?", [projectId], query.kind, { projectId: query.input.projectId }, query.input.limit, query.input.cursor);
      } else if (query.kind === "workflow.revision") {
        const value = this.one("workflow_revisions", query.revisionId);
        if (value.workflowId !== query.id) throw new Conflict("resource_not_found");
        const { digest, body, ...revision } = value;
        void digest; void body;
        data = workflows.planRevision.parse(revision);
      } else if (query.kind === "workflow.revisions") {
        this.one("workflows", query.id);
        const page = this.page("workflow_revisions", "workflow_id=?", [query.id], query.kind, { workflowId: query.id }, query.input.limit, query.input.cursor, "revision");
        data = { ...page, items: page.items.map(({ digest, body, ...revision }) => { void digest; void body; return workflows.planRevision.parse(revision); }) };
      } else if (query.kind === "tracking.agents") {
        data = this.page(`(SELECT a.*,
          (SELECT count(*) FROM runs r WHERE r.agent_id=a.id AND r.state='running' AND r.last_received_at>=${now - 60000}) AS fresh_running,
          (SELECT count(*) FROM runs r WHERE r.agent_id=a.id AND r.state='queued' AND r.last_sequence=0) AS queued_no_report,
          (SELECT count(*) FROM runs r WHERE r.agent_id=a.id AND r.state IN ('queued','running') AND r.last_received_at<${now - 60000}) AS stale_active FROM agents a)`, "1", [], "tracking.agents", {}, query.input.limit, query.input.cursor);
      } else if (query.kind === "activity") data = this.activity(query.input);
      else if (query.kind === "tracking.run") {
        const value = this.run(query.id);
        data = this.summary(this.joinedRuns("r.id=?", [value.id])[0], now);
      } else if (query.kind === "tracking.tasks") data = this.trackingTasks(this.taskList(query.input), now);
      else if (query.kind === "tracking.board") {
        const value = this.one("projects", query.id);
        data = { columns: ["backlog", "in_progress", "review", "completed"].map(status => ({ status,
          ...this.trackingTasks(this.taskList({ ...query.input, projectId: value.id as string, status: status as z.infer<typeof task>["status"] }), now) })) };
      } else if (query.kind === "tracking.runs") {
        const original = this.snapshot({ kind: "runs", input: query.input }, now).body.data as { items: Row[]; total: number; nextCursor: string | null };
        const ids = original.items.map(value => value.id);
        const rows = ids.length ? this.joinedRuns(`r.id IN (${ids.map(() => "?").join(",")})`, ids) : [];
        const summaries = new Map(rows.map(row => [row.id, this.summary(row, now)]));
        data = { ...original, items: original.items.map(value => summaries.get(value.id)) };
      } else if (query.kind === "run") data = this.runView(this.run(query.id), now);
      else if (query.kind === "agent")
        data = this.agentView(this.one("agents", query.id), now);
      else if (query.kind === "agents") {
        const page = this.page(
          `(SELECT agents.*,EXISTS(SELECT 1 FROM runs WHERE agent_id=agents.id AND state='running' AND last_received_at>=${now - 60000}) AS reporting FROM agents)`,
          "1",
          [],
          "agents",
          {},
          query.input.limit,
          query.input.cursor,
        );
        data = {
          ...page,
          items: page.items.map((value) => this.agentView(value, now)),
        };
      } else if (query.kind === "runs") {
        const { limit, cursor, ...filters } = query.input;
        const clauses: string[] = [];
        const params: unknown[] = [];
        for (const [key, column] of [
          ["projectId", "project_id"],
          ["agentId", "agent_id"],
          ["taskId", "task_id"],
          ["state", "state"],
        ] as const)
          if (filters[key]) {
            clauses.push(column + "=?");
            const resolvedFilter = column.endsWith("_id")
              ? (this.find(
                  (
                    {
                      projectId: "projects",
                      taskId: "tasks",
                      assignedAgentId: "agents",
                      agentId: "agents",
                    } as Record<string, string>
                  )[key],
                  filters[key] as string,
                )?.id ?? filters[key])
              : filters[key];
            params.push(resolvedFilter);
            if (column.endsWith("_id"))
              Object.assign(filters, { [key]: resolvedFilter });
          }
        if (filters.stale !== undefined) {
          clauses.push(
            filters.stale === "true"
              ? "(state IN ('queued','running') AND last_received_at<?)"
              : "NOT (state IN ('queued','running') AND last_received_at<?)",
          );
          params.push(now - 60000);
        }
        const page = this.page(
          "runs",
          clauses.join(" AND ") || "1",
          params,
          "runs",
          filters,
          limit,
          cursor,
          "registration_order",
        );
        data = {
          ...page,
          items: page.items.map((value) => {
            delete value.registrationOrder;
            return this.runView(run.parse(value), now);
          }),
        };
      } else if (query.kind === "events") {
        const value = this.run(query.id);
        const page = this.page(
          "(SELECT event_id AS id,run_id,sequence,body,payload_pruned_at FROM run_events)",
          "run_id=?",
          [value.id],
          "events",
          { runId: value.id },
          query.input.limit,
          query.input.cursor,
          "sequence",
          true,
        );
        data = {
          ...page,
          items: page.items.map((value) => this.eventView(value.body as string,value.payloadPrunedAt as string|null)),
        };
      } else if (query.kind === "settings") data = this.settings();
      else if (query.kind === "project") data = this.one("projects", query.id);
      else if (query.kind === "projects") {
        const { limit, cursor, ...filters } = query.input;
        data = this.page(
          "projects",
          filters.archived === undefined
            ? "1"
            : filters.archived === "true"
              ? "archived_at IS NOT NULL"
              : "archived_at IS NULL",
          [],
          "projects",
          filters,
          limit,
          cursor,
        );
      } else if (query.kind === "tasks") data = this.taskList(query.input);
      else if (query.kind === "comments") {
        const value = this.one("tasks", query.id);
        data = this.page(
          "comments",
          "task_id=?",
          [value.id],
          "comments",
          { taskId: value.id },
          query.input.limit,
          query.input.cursor,
        );
      } else if (query.kind === "board") {
        const value = this.one("projects", query.id);
        data = {
          columns: ["backlog", "in_progress", "review", "completed"].map(
            (status) => ({
              status,
              ...this.taskList({
                ...query.input,
                projectId: value.id as string,
                status: status as z.infer<typeof task>["status"],
              }),
            }),
          ),
        };
      } else if (query.kind === "overview")
        data = this.overview(query.input, now);
      else {
        const value = task.parse(this.one("tasks", query.id));
        const accepted = this.db
          .prepare(
            "SELECT * FROM completions WHERE task_id=? AND work_revision=? ORDER BY accepted_at DESC,id DESC LIMIT 1",
          )
          .get(value.id, value.workRevision) as Row | undefined;
        const latest = this.db
          .prepare(
            "SELECT id,project_id,agent_id,task_id,purpose,model,work_revision,artifact_ref,rework_round,state,last_sequence,last_received_at,started_at,ended_at,version,created_at FROM runs WHERE task_id=? ORDER BY registration_order DESC LIMIT 1",
          )
          .get(value.id) as Row | undefined;
        const { history, historyLimit, completionCursor, reopenCursor } =
          query.input;
        data = {
          task: value,
          readiness: this.readiness(value.id),
          evidence: this.evidence(value),
          currentCompletion:
            value.status === "completed" && accepted
              ? serialize(accepted)
              : null,
          latestRun: latest ? serialize(latest) : null,
          history: {
            commentsUrl: `/api/v1/tasks/${value.id}/comments`,
            completions:
              history === "reopen"
                ? null
                : this.history(
                    value.id,
                    "completion",
                    historyLimit,
                    completionCursor,
                  ),
            reopens:
              history === "completion"
                ? null
                : this.history(value.id, "reopen", historyLimit, reopenCursor),
          },
        };
      }
      return { status: 200, body: this.body(data) };
    })();
  }
}
