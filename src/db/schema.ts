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
    acknowledgement: text("acknowledgement").notNull(),
    occurredAt: integer("occurred_at").notNull(),
    receivedAt: integer("received_at").notNull(),
  },
  (t) => [
    uniqueIndex("run_events_run_sequence").on(t.runId, t.sequence),
    check(
      "run_events_sequence",
      sql`typeof(${t.sequence})='integer' AND ${t.sequence} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "run_events_type",
      sql`${t.type} IN ('run.started','run.heartbeat','run.progress','run.succeeded','run.failed','run.cancelled')`,
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
