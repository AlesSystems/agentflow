import {
  sqliteTable,
  integer,
  text,
  uniqueIndex,
  index,
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
export const projects = sqliteTable('projects', {
 id:text('id').primaryKey(), name:text('name').notNull(),repositoryPath:text('repository_path'),archivedAt:integer('archived_at'),version:integer('version').notNull(),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),
}, t=>[index('projects_created').on(t.createdAt,t.id)]);
export const agents = sqliteTable('agents', {id:text('id').primaryKey(),displayName:text('display_name').notNull(),source:text('source').notNull(),defaultRole:text('default_role').notNull(),version:integer('version').notNull(),createdAt:integer('created_at').notNull()});
export const tasks = sqliteTable('tasks', {
 id:text('id').primaryKey(),projectId:text('project_id').notNull().references(()=>projects.id),parentTaskId:text('parent_task_id'),title:text('title').notNull(),description:text('description').notNull(),acceptanceCriteria:text('acceptance_criteria').notNull(),status:text('status').notNull(),priority:text('priority').notNull(),tags:text('tags').notNull(),assignedAgentId:text('assigned_agent_id').references(()=>agents.id),targetRole:text('target_role'),branch:text('branch'),pullRequestUrl:text('pull_request_url'),blockedReason:text('blocked_reason'),version:integer('version').notNull(),workRevision:integer('work_revision').notNull(),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),completedAt:integer('completed_at'),
},t=>[uniqueIndex('tasks_id_project').on(t.id,t.projectId),index('tasks_project_status_created').on(t.projectId,t.status,t.createdAt,t.id),index('tasks_created').on(t.createdAt,t.id)]);
export const runs = sqliteTable('runs', {id:text('id').primaryKey(),projectId:text('project_id').notNull().references(()=>projects.id),agentId:text('agent_id').notNull().references(()=>agents.id),taskId:text('task_id').references(()=>tasks.id),purpose:text('purpose').notNull(),model:text('model'),workRevision:integer('work_revision'),state:text('state').notNull(),lastSequence:integer('last_sequence').notNull(),lastReceivedAt:integer('last_received_at').notNull(),startedAt:integer('started_at'),endedAt:integer('ended_at'),version:integer('version').notNull(),createdAt:integer('created_at').notNull()},t=>[index('runs_task_created').on(t.taskId,t.createdAt,t.id),index('runs_agent_received').on(t.agentId,t.lastReceivedAt)]);
export const comments = sqliteTable('comments',{id:text('id').primaryKey(),taskId:text('task_id').notNull().references(()=>tasks.id),text:text('text').notNull(),actor:text('actor').notNull(),createdAt:integer('created_at').notNull()},t=>[index('comments_task_created').on(t.taskId,t.createdAt,t.id)]);
export const completions = sqliteTable('completions',{id:text('id').primaryKey(),taskId:text('task_id').notNull().references(()=>tasks.id),workRevision:integer('work_revision').notNull(),implementationRunId:text('implementation_run_id').references(()=>runs.id),actor:text('actor').notNull(),evidenceNote:text('evidence_note').notNull(),evidenceUrl:text('evidence_url'),acceptedAt:integer('accepted_at').notNull()},t=>[index('completions_task_accepted').on(t.taskId,t.acceptedAt,t.id)]);
export const reopens = sqliteTable('reopens',{id:text('id').primaryKey(),taskId:text('task_id').notNull().references(()=>tasks.id),workRevision:integer('work_revision').notNull(),actor:text('actor').notNull(),reason:text('reason').notNull(),createdAt:integer('created_at').notNull()},t=>[index('reopens_task_created').on(t.taskId,t.createdAt,t.id)]);
export const settings = sqliteTable('settings',{singleton:integer('singleton').primaryKey(),timezone:text('timezone').notNull(),version:integer('version').notNull()});
export const changes = sqliteTable('changes',{cursor:integer('cursor').primaryKey({autoIncrement:true}),entityType:text('entity_type').notNull(),entityId:text('entity_id').notNull(),projectId:text('project_id').references(()=>projects.id),kind:text('kind').notNull(),receivedAt:integer('received_at').notNull()});
export const receipts = sqliteTable('receipts',{principal:text('principal').notNull(),method:text('method').notNull(),path:text('path').notNull(),key:text('key').notNull(),digest:text('digest').notNull(),status:integer('status').notNull(),body:text('body').notNull()});
