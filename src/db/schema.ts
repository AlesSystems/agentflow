import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  uniqueIndex,
  index,
  check,
  foreignKey,
  primaryKey,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
export const metadata = sqliteTable("instance_metadata", {
  singleton: integer("singleton").primaryKey(),
  generation: text("generation").notNull(),
  schemaVersion: integer("schema_version").notNull(),
});
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    secretHash: text("secret_hash").notNull(),
    principal: text("principal").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("session_hash").on(table.secretHash),
    index("sessions_expiry").on(table.expiresAt),
  ],
);
export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    repositoryPath: text("repository_path"),
    archivedAt: integer("archived_at"),
    version: integer("version").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    check("projects_version", sql`${t.version}>0`),
    index("projects_created").on(t.createdAt, t.id),
    index("projects_id_case").on(sql`${t.id} COLLATE NOCASE`),
  ],
);
export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    source: text("source").notNull(),
    defaultRole: text("default_role").notNull(),
    version: integer("version").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    check(
      "agents_default_role",
      sql`${t.defaultRole} IN ('orchestrator','implementation','reviewer','verifier')`,
    ),
    check("agents_version", sql`${t.version}>0`),
    index("agents_id_case").on(sql`${t.id} COLLATE NOCASE`),
  ],
);
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    parentTaskId: text("parent_task_id").references(
      (): AnySQLiteColumn => tasks.id,
    ),
    title: text("title").notNull(),
    description: text("description").notNull(),
    acceptanceCriteria: text("acceptance_criteria").notNull(),
    status: text("status").notNull(),
    priority: text("priority").notNull(),
    tags: text("tags").notNull(),
    assignedAgentId: text("assigned_agent_id").references(() => agents.id),
    targetRole: text("target_role"),
    branch: text("branch"),
    pullRequestUrl: text("pull_request_url"),
    blockedReason: text("blocked_reason"),
    version: integer("version").notNull(),
    workRevision: integer("work_revision").notNull(),
    reviewRequired: integer("review_required", {mode:"boolean"}).notNull().default(false),
    verificationRequired: integer("verification_required", {mode:"boolean"}).notNull().default(false),
    reworkRound: integer("rework_round").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (t) => [
    uniqueIndex("tasks_id_project").on(t.id, t.projectId),
    foreignKey({
      columns: [t.parentTaskId, t.projectId],
      foreignColumns: [t.id, t.projectId],
    }),
    check("tasks_version", sql`${t.version}>0`),
    check("tasks_work_revision", sql`${t.workRevision}>0`),
    check(
      "tasks_status",
      sql`${t.status} IN ('backlog','in_progress','review','completed')`,
    ),
    check(
      "tasks_priority",
      sql`${t.priority} IN ('low','normal','high','urgent')`,
    ),
    check("tasks_tags", sql`json_valid(${t.tags})`),
    check(
      "tasks_target_role",
      sql`${t.targetRole} IN ('orchestrator','implementation','reviewer','verifier')`,
    ),
    index("tasks_project_status_created").on(
      t.projectId,
      t.status,
      t.createdAt,
      t.id,
    ),
    index("tasks_created").on(t.createdAt, t.id),
    index("tasks_id_case").on(sql`${t.id} COLLATE NOCASE`),
  ],
);
export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    taskId: text("task_id").references(() => tasks.id),
    purpose: text("purpose").notNull(),
    model: text("model"),
    workRevision: integer("work_revision"),
    artifactRef: text("artifact_ref"),
    reworkRound: integer("rework_round"),
    state: text("state").notNull(),
    lastSequence: integer("last_sequence").notNull(),
    lastReceivedAt: integer("last_received_at").notNull(),
    startedAt: integer("started_at"),
    endedAt: integer("ended_at"),
    version: integer("version").notNull(),
    createdAt: integer("created_at").notNull(),
    // Additive SQLite column is physically nullable; reviewed triggers enforce required immutable order.
    registrationOrder: integer("registration_order").notNull(),
  },
  (t) => [
    uniqueIndex("runs_registration_order").on(t.registrationOrder),
    index("runs_task_registration").on(
      t.taskId,
      sql`${t.registrationOrder} DESC`,
    ),
    check(
      "runs_registration_order",
      sql`${t.registrationOrder} IS NULL OR (typeof(${t.registrationOrder})='integer' AND ${t.registrationOrder} BETWEEN 1 AND 9007199254740991)`,
    ),
    foreignKey({
      columns: [t.taskId, t.projectId],
      foreignColumns: [tasks.id, tasks.projectId],
    }),
    uniqueIndex("runs_active_task")
      .on(t.taskId)
      .where(
        sql`${t.taskId} IS NOT NULL AND ${t.state} IN ('queued','running')`,
      ),
    check("runs_version", sql`${t.version}>0`),
    check("runs_work_revision", sql`${t.workRevision}>0`),
    check("runs_last_sequence", sql`${t.lastSequence}>=0`),
    check(
      "runs_purpose",
      sql`${t.purpose} IN ('planning','implementation','review','verification')`,
    ),
    check(
      "runs_state",
      sql`${t.state} IN ('queued','running','succeeded','failed','cancelled','interrupted')`,
    ),
    check(
      "runs_task_revision",
      sql`(${t.taskId} IS NULL AND ${t.purpose}='planning' AND ${t.workRevision} IS NULL) OR (${t.taskId} IS NOT NULL AND ${t.workRevision} IS NOT NULL)`,
    ),
    index("runs_task_created").on(t.taskId, t.createdAt, t.id),
    index("runs_agent_received").on(t.agentId, t.lastReceivedAt),
    index("runs_id_case").on(sql`${t.id} COLLATE NOCASE`),
  ],
);
export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    text: text("text").notNull(),
    actor: text("actor").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    check("comments_actor", sql`${t.actor} IN ('operator','reporter')`),
    index("comments_task_created").on(t.taskId, t.createdAt, t.id),
  ],
);
export const completions = sqliteTable(
  "completions",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    workRevision: integer("work_revision").notNull(),
    implementationRunId: text("implementation_run_id").references(
      () => runs.id,
    ),
    actor: text("actor").notNull(),
    evidenceNote: text("evidence_note").notNull(),
    evidenceUrl: text("evidence_url"),
    acceptedAt: integer("accepted_at").notNull(),
  },
  (t) => [
    check("completions_actor", sql`${t.actor}='operator'`),
    check("completions_work_revision", sql`${t.workRevision}>0`),
    index("completions_task_accepted").on(t.taskId, t.acceptedAt, t.id),
  ],
);
export const reopens = sqliteTable(
  "reopens",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    workRevision: integer("work_revision").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    check("reopens_actor", sql`${t.actor}='operator'`),
    check("reopens_work_revision", sql`${t.workRevision}>0`),
    index("reopens_task_created").on(t.taskId, t.createdAt, t.id),
  ],
);
export const settings = sqliteTable(
  "settings",
  {
    singleton: integer("singleton").primaryKey(),
    timezone: text("timezone").notNull(),
    version: integer("version").notNull(),
  },
  (t) => [
    check("settings_singleton", sql`${t.singleton}=1`),
    check("settings_version", sql`${t.version}>0`),
  ],
);
export const changes = sqliteTable("changes", {
  cursor: integer("cursor").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  projectId: text("project_id").references(() => projects.id),
  kind: text("kind").notNull(),
  receivedAt: integer("received_at").notNull(),
});
export const receipts = sqliteTable(
  "receipts",
  {
    principal: text("principal").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    key: text("key").notNull(),
    digest: text("digest").notNull(),
    status: integer("status").notNull(),
    body: text("body").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.principal, t.method, t.path, t.key] }),
    check("receipts_body", sql`json_valid(${t.body})`),
  ],
);

export const runOrderAllocator = sqliteTable(
  "run_order_allocator",
  {
    singleton: integer("singleton").primaryKey(),
    lastValue: integer("last_value").notNull(),
  },
  (t) => [
    check("run_order_allocator_singleton", sql`${t.singleton}=1`),
    check(
      "run_order_allocator_value",
      sql`typeof(${t.lastValue})='integer' AND ${t.lastValue} BETWEEN 0 AND 9007199254740991`,
    ),
  ],
);

export const runRegistrations = sqliteTable(
  "run_registrations",
  {
    runId: text("run_id")
      .primaryKey()
      .notNull()
      .references(() => runs.id),
    digest: text("digest").notNull(),
    body: text("body").notNull(),
  },
  (t) => [check("run_registrations_body", sql`json_valid(${t.body})`)],
);
export const runEvents = sqliteTable(
  "run_events",
  {
    eventId: text("event_id").primaryKey().notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    digest: text("digest").notNull(),
    body: text("body").notNull(),
    payloadPrunedAt: integer("payload_pruned_at"),
    acknowledgement: text("acknowledgement").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    receivedAt: integer("received_at").notNull(),
  },
  (t) => [
    uniqueIndex("run_events_run_sequence").on(t.runId, t.sequence),
    index("run_events_id_case").on(sql`${t.eventId} COLLATE NOCASE`),
    check(
      "run_events_sequence",
      sql`typeof(${t.sequence})='integer' AND ${t.sequence} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "run_events_type",
      sql`${t.type} IN ('run.started','run.heartbeat','run.progress','run.succeeded','run.failed','run.cancelled','run.usage')`,
    ),
    check("run_events_body", sql`json_valid(${t.body})`),
    check("run_events_acknowledgement", sql`json_valid(${t.acknowledgement})`),
  ],
);
export const runClosures = sqliteTable(
  "run_closures",
  {
    id: text("id").primaryKey().notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    reason: text("reason").notNull(),
    actor: text("actor").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("run_closures_run").on(t.runId),
    check("run_closures_actor", sql`${t.actor}='operator'`),
  ],
);
export const workflows = sqliteTable("workflows", {
 id: text("id").primaryKey().notNull(), projectId: text("project_id").notNull().references(() => projects.id), name: text("name").notNull(), version: integer("version").notNull(), createdAt: integer("created_at").notNull(),
}, t => [index("workflows_project").on(t.projectId, t.createdAt, t.id), check("workflows_version", sql`${t.version} BETWEEN 1 AND 9007199254740991`)]);
export const workflowRevisions = sqliteTable("workflow_revisions", {
 id: text("id").primaryKey().notNull(), workflowId: text("workflow_id").notNull().references(() => workflows.id), revision: integer("revision").notNull(), nodes: text("nodes").notNull(), edges: text("edges").notNull(), digest: text("digest").notNull(), body: text("body").notNull(), createdAt: integer("created_at").notNull(),
}, t => [uniqueIndex("workflow_revisions_identity").on(t.workflowId, t.revision), index("workflow_revisions_workflow").on(t.workflowId, t.revision), check("workflow_revisions_revision", sql`${t.revision} BETWEEN 1 AND 9007199254740991`), check("workflow_revisions_nodes", sql`json_valid(${t.nodes})`), check("workflow_revisions_edges", sql`json_valid(${t.edges})`), check("workflow_revisions_body", sql`json_valid(${t.body})`)]);
export const workflowIdentities = sqliteTable("workflow_identities", { workflowId: text("workflow_id").primaryKey().notNull().references(() => workflows.id), digest: text("digest").notNull(), body: text("body").notNull() }, t => [check("workflow_identities_body", sql`json_valid(${t.body})`)]);
export const workflowOrderAllocator = sqliteTable("workflow_order_allocator", { singleton: integer("singleton").primaryKey(), lastValue: integer("last_value").notNull() }, t => [check("workflow_order_singleton", sql`${t.singleton}=1`), check("workflow_order_value", sql`typeof(${t.lastValue})='integer' AND ${t.lastValue} BETWEEN 0 AND 9007199254740991`)]);
export const workflowRuns = sqliteTable("workflow_runs", {
 id: text("id").primaryKey().notNull(), projectId: text("project_id").notNull().references(() => projects.id), workflowId: text("workflow_id").notNull().references(() => workflows.id), planRevisionId: text("plan_revision_id").notNull().references(() => workflowRevisions.id), registrationOrder: integer("registration_order").notNull(), state: text("state").notNull(), version: integer("version").notNull(), lastSequence: integer("last_sequence").notNull(), lastReceivedAt: integer("last_received_at").notNull(), createdAt: integer("created_at").notNull(), startedAt: integer("started_at"), endedAt: integer("ended_at"),
}, t => [uniqueIndex("workflow_runs_order").on(t.registrationOrder), uniqueIndex("workflow_runs_active").on(t.workflowId).where(sql`${t.state} IN ('queued','running')`), index("workflow_runs_history").on(t.workflowId, t.registrationOrder), check("workflow_runs_registration_order", sql`${t.registrationOrder} BETWEEN 1 AND 9007199254740991`), check("workflow_runs_state", sql`${t.state} IN ('queued','running','succeeded','failed','cancelled','interrupted')`), check("workflow_runs_version", sql`${t.version} BETWEEN 1 AND 9007199254740991`), check("workflow_runs_sequence", sql`${t.lastSequence} BETWEEN 0 AND 9007199254740991`)]);
export const workflowRunRegistrations = sqliteTable("workflow_run_registrations", { runId: text("run_id").primaryKey().notNull().references(() => workflowRuns.id), digest: text("digest").notNull(), body: text("body").notNull() }, t => [check("workflow_registration_body", sql`json_valid(${t.body})`)]);
export const workflowEvents = sqliteTable("workflow_events", {
 eventId: text("event_id").primaryKey().notNull(), workflowRunId: text("workflow_run_id").notNull().references(() => workflowRuns.id), sequence: integer("sequence").notNull(), type: text("type").notNull(), digest: text("digest").notNull(), body: text("body").notNull(), acknowledgement: text("acknowledgement").notNull(), occurredAt: integer("occurred_at").notNull(), receivedAt: integer("received_at").notNull(),
}, t => [uniqueIndex("workflow_events_sequence").on(t.workflowRunId, t.sequence), check("workflow_events_sequence", sql`${t.sequence} BETWEEN 1 AND 9007199254740991`), check("workflow_events_type", sql`${t.type} IN ('workflow.started','workflow.node.reported','workflow.heartbeat','workflow.succeeded','workflow.failed','workflow.cancelled')`), check("workflow_events_body", sql`json_valid(${t.body})`), check("workflow_events_acknowledgement", sql`json_valid(${t.acknowledgement})`)]);
export const workflowNodeObservations = sqliteTable("workflow_node_observations", { id: text("id").primaryKey().notNull().references(() => workflowEvents.eventId), workflowRunId: text("workflow_run_id").notNull().references(() => workflowRuns.id), nodeId: text("node_id").notNull(), runId: text("run_id").references(() => runs.id), sequence: integer("sequence").notNull(), createdAt: integer("created_at").notNull(), body: text("body").notNull() }, t => [uniqueIndex("workflow_node_sequence").on(t.workflowRunId, t.sequence), index("workflow_node_history").on(t.workflowRunId, t.nodeId, t.sequence), check("workflow_node_body", sql`json_valid(${t.body})`)]);
export const workflowClosures = sqliteTable("workflow_closures", { id: text("id").primaryKey().notNull(), workflowRunId: text("workflow_run_id").notNull().references(() => workflowRuns.id), reason: text("reason").notNull(), actor: text("actor").notNull(), createdAt: integer("created_at").notNull() }, t => [uniqueIndex("workflow_closures_run").on(t.workflowRunId), check("workflow_closure_actor", sql`${t.actor}='operator'`)]);

export const taskDependencies = sqliteTable("task_dependencies", {
  taskId: text("task_id").notNull(), prerequisiteId: text("prerequisite_id").notNull(), projectId: text("project_id").notNull(),
}, t => [primaryKey({columns:[t.taskId,t.prerequisiteId]}), foreignKey({columns:[t.taskId,t.projectId],foreignColumns:[tasks.id,tasks.projectId]}), foreignKey({columns:[t.prerequisiteId,t.projectId],foreignColumns:[tasks.id,tasks.projectId]}), check("task_dependencies_self",sql`${t.taskId}<>${t.prerequisiteId}`), index("task_dependencies_project").on(t.projectId,t.taskId), index("task_dependencies_prerequisite").on(t.prerequisiteId,t.taskId)]);
export const taskArtifacts = sqliteTable("task_artifacts", {
  id:text("id").primaryKey(), taskId:text("task_id").notNull().references(()=>tasks.id), runId:text("run_id").references(()=>runs.id), workRevision:integer("work_revision").notNull(), artifactRef:text("artifact_ref").notNull(), reworkRound:integer("rework_round").notNull(), actor:text("actor").notNull(), displayUrl:text("display_url"), createdAt:integer("created_at").notNull(),
}, t => [check("task_artifacts_revision",sql`${t.workRevision}>0`),check("task_artifacts_ref",sql`length(${t.artifactRef}) BETWEEN 1 AND 2000`),check("task_artifacts_round",sql`${t.reworkRound}>=0`),check("task_artifacts_actor",sql`${t.actor} IN ('operator','reporter')`),uniqueIndex("task_artifacts_tuple").on(t.taskId,t.workRevision,t.reworkRound),index("task_artifacts_current").on(t.taskId,t.workRevision,t.reworkRound,t.createdAt,t.id)]);
export const gateDecisions = sqliteTable("gate_decisions", {
  id:text("id").primaryKey(), taskId:text("task_id").notNull().references(()=>tasks.id),runId:text("run_id").notNull().references(()=>runs.id),eventId:text("event_id").notNull().unique().references(()=>runEvents.eventId),workRevision:integer("work_revision").notNull(),artifactRef:text("artifact_ref").notNull(),reworkRound:integer("rework_round").notNull(),purpose:text("purpose").notNull(),decision:text("decision").notNull(),evidenceNote:text("evidence_note").notNull(),createdAt:integer("created_at").notNull(),
}, t=> [check("gate_decisions_revision",sql`${t.workRevision}>0`),check("gate_decisions_ref",sql`length(${t.artifactRef}) BETWEEN 1 AND 2000`),check("gate_decisions_round",sql`${t.reworkRound}>=0`),check("gate_decisions_purpose",sql`${t.purpose} IN ('review','verification')`),check("gate_decisions_decision",sql`${t.decision} IN ('approved','changes_requested')`),check("gate_decisions_note",sql`length(${t.evidenceNote}) BETWEEN 1 AND 4000`),index("gate_decisions_current").on(t.taskId,t.workRevision,t.artifactRef,t.reworkRound,t.purpose,t.decision,t.createdAt,t.id)]);
export const taskReworks = sqliteTable("task_reworks", {
 id:text("id").primaryKey(),taskId:text("task_id").notNull().references(()=>tasks.id),workRevision:integer("work_revision").notNull(),reworkRound:integer("rework_round").notNull(),reason:text("reason").notNull(),actor:text("actor").notNull(),createdAt:integer("created_at").notNull(),
},t=> [check("task_reworks_revision",sql`${t.workRevision}>0`),check("task_reworks_round",sql`${t.reworkRound}>0`),check("task_reworks_reason",sql`length(${t.reason}) BETWEEN 1 AND 4000`),check("task_reworks_actor",sql`${t.actor}='operator'`),index("task_reworks_history").on(t.taskId,t.createdAt,t.id)]);

export const githubConnection = sqliteTable("github_connection", { singleton:integer("singleton").primaryKey(),enabled:integer("enabled").notNull(),repositories:text("repositories").notNull(),version:integer("version").notNull(),lastAttemptedAt:integer("last_attempted_at"),lastFetchedAt:integer("last_fetched_at"),lastError:text("last_error"),retryNotBefore:integer("retry_not_before") });
export const githubPullRequests = sqliteTable("github_pull_requests", {repository:text("repository").notNull(),number:integer("number").notNull(),url:text("url").notNull(),title:text("title").notNull(),state:text("state").notNull(),draft:integer("draft").notNull(),headSha:text("head_sha").notNull(),baseBranch:text("base_branch").notNull(),mergedAt:text("merged_at"),previousHeadSha:text("previous_head_sha"),fetchedAt:integer("fetched_at").notNull(),lastAttemptedAt:integer("last_attempted_at").notNull(),lastError:text("last_error")}, t=>[primaryKey({columns:[t.repository,t.number]})]);
export const githubRefreshIntents = sqliteTable("github_refresh_intents", {principal:text("principal").notNull(),method:text("method").notNull(),path:text("path").notNull(),key:text("key").notNull(),digest:text("digest").notNull(),request:text("request").notNull(),generation:text("generation").notNull(),connectionVersion:integer("connection_version").notNull(),admittedAt:integer("admitted_at").notNull(),state:text("state").notNull(),completedAt:integer("completed_at"),result:text("result")},t=>[primaryKey({columns:[t.principal,t.method,t.path,t.key]})]);
export const githubLookupAttempts = sqliteTable("github_lookup_attempts", {repository:text("repository").notNull(),number:integer("number").notNull(),attemptedAt:integer("attempted_at").notNull(),error:text("error")},t=>[primaryKey({columns:[t.repository,t.number]})]);

export const retentionState=sqliteTable("retention_state",{singleton:integer("singleton").primaryKey(),version:integer("version").notNull()});
export const retentionPreviews=sqliteTable("retention_previews",{id:text("id").primaryKey().notNull(),principal:text("principal").notNull(),cutoff:integer("cutoff").notNull(),expiresAt:integer("expires_at").notNull(),generation:text("generation").notNull(),version:integer("version").notNull(),digest:text("digest").notNull(),candidates:text("candidates").notNull(),issuedAt:integer("issued_at").notNull()});
export const retentionConsumptions=sqliteTable("retention_consumptions",{previewId:text("preview_id").primaryKey().notNull().references(()=>retentionPreviews.id)});

export const usageMeasurements = sqliteTable("usage_measurements", {
 runId: text("run_id").notNull().references(() => runs.id),
 usageId: text("usage_id").notNull(),
 eventId: text("event_id").notNull().references(() => runEvents.eventId),
 payloadDigest: text("payload_digest").notNull(),
 source: text("source").notNull(),
 model: text("model").notNull(),
 inputTokens: integer("input_tokens"),
 outputTokens: integer("output_tokens"),
 billingBasis: text("billing_basis"),
 measuredAt: integer("measured_at").notNull(),
 firstReceivedAt: integer("first_received_at").notNull(),
}, t => [
 primaryKey({columns:[t.runId,t.usageId]}),
 uniqueIndex("usage_event").on(t.eventId),
 index("usage_receipt").on(t.firstReceivedAt,t.runId,t.usageId),
 check("usage_id_length",sql`length(${t.usageId}) BETWEEN 1 AND 200`),
 check("usage_source_length",sql`length(${t.source}) BETWEEN 1 AND 200`),
 check("usage_model_length",sql`length(${t.model}) BETWEEN 1 AND 200`),
 check("usage_input_tokens",sql`${t.inputTokens} IS NULL OR (typeof(${t.inputTokens})='integer' AND ${t.inputTokens} BETWEEN 0 AND 9007199254740991)`),
 check("usage_output_tokens",sql`${t.outputTokens} IS NULL OR (typeof(${t.outputTokens})='integer' AND ${t.outputTokens} BETWEEN 0 AND 9007199254740991)`),
 check("usage_billing_basis",sql`${t.billingBasis} IS NULL OR ${t.billingBasis} IN ('input_output_only','unrepresented')`),
 check("usage_measured_at",sql`typeof(${t.measuredAt})='integer' AND ${t.measuredAt} BETWEEN -8640000000000000 AND 8640000000000000`),
 check("usage_first_received_at",sql`typeof(${t.firstReceivedAt})='integer' AND ${t.firstReceivedAt} BETWEEN 0 AND 8640000000000000`),
]);
