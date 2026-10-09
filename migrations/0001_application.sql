CREATE TABLE projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, repository_path TEXT, archived_at INTEGER,
 version INTEGER NOT NULL CHECK(version>0), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX projects_created ON projects(created_at DESC,id DESC);
CREATE TABLE agents (
 id TEXT PRIMARY KEY, display_name TEXT NOT NULL, source TEXT NOT NULL,
 default_role TEXT NOT NULL CHECK(default_role IN ('orchestrator','implementation','reviewer','verifier')),
 version INTEGER NOT NULL CHECK(version>0), created_at INTEGER NOT NULL
);
CREATE TABLE tasks (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), parent_task_id TEXT REFERENCES tasks(id),
 title TEXT NOT NULL, description TEXT NOT NULL, acceptance_criteria TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('backlog','in_progress','review','completed')),
 priority TEXT NOT NULL CHECK(priority IN ('low','normal','high','urgent')), tags TEXT NOT NULL CHECK(json_valid(tags)),
 assigned_agent_id TEXT REFERENCES agents(id), target_role TEXT CHECK(target_role IN ('orchestrator','implementation','reviewer','verifier')),
 branch TEXT, pull_request_url TEXT, blocked_reason TEXT, version INTEGER NOT NULL CHECK(version>0),
 work_revision INTEGER NOT NULL CHECK(work_revision>0), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
 UNIQUE(id,project_id), FOREIGN KEY(parent_task_id,project_id) REFERENCES tasks(id,project_id)
);
CREATE INDEX tasks_project_status_created ON tasks(project_id,status,created_at DESC,id DESC);
CREATE INDEX tasks_created ON tasks(created_at DESC,id DESC);
CREATE TABLE runs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), agent_id TEXT NOT NULL REFERENCES agents(id),
 task_id TEXT REFERENCES tasks(id), purpose TEXT NOT NULL CHECK(purpose IN ('planning','implementation','review','verification')),
 model TEXT, work_revision INTEGER CHECK(work_revision>0), state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','failed','cancelled','interrupted')),
 last_sequence INTEGER NOT NULL CHECK(last_sequence>=0), last_received_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER,
 version INTEGER NOT NULL CHECK(version>0), created_at INTEGER NOT NULL,
 FOREIGN KEY(task_id,project_id) REFERENCES tasks(id,project_id),
 CHECK((task_id IS NULL AND purpose='planning' AND work_revision IS NULL) OR (task_id IS NOT NULL AND work_revision IS NOT NULL))
);
CREATE UNIQUE INDEX runs_active_task ON runs(task_id) WHERE task_id IS NOT NULL AND state IN ('queued','running');
CREATE INDEX runs_task_created ON runs(task_id,created_at DESC,id DESC);
CREATE INDEX runs_agent_received ON runs(agent_id,last_received_at DESC);
CREATE TABLE comments (id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),text TEXT NOT NULL,actor TEXT NOT NULL CHECK(actor IN ('operator','reporter')),created_at INTEGER NOT NULL);
CREATE INDEX comments_task_created ON comments(task_id,created_at DESC,id DESC);
CREATE TABLE completions (id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),work_revision INTEGER NOT NULL CHECK(work_revision>0),implementation_run_id TEXT REFERENCES runs(id),actor TEXT NOT NULL CHECK(actor='operator'),evidence_note TEXT NOT NULL,evidence_url TEXT,accepted_at INTEGER NOT NULL);
CREATE INDEX completions_task_accepted ON completions(task_id,accepted_at DESC,id DESC);
CREATE TABLE reopens (id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),work_revision INTEGER NOT NULL CHECK(work_revision>0),actor TEXT NOT NULL CHECK(actor='operator'),reason TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX reopens_task_created ON reopens(task_id,created_at DESC,id DESC);
CREATE TABLE settings(singleton INTEGER PRIMARY KEY CHECK(singleton=1),timezone TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0));
INSERT INTO settings VALUES(1,'UTC',1);
CREATE TABLE changes(cursor INTEGER PRIMARY KEY AUTOINCREMENT,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,project_id TEXT REFERENCES projects(id),kind TEXT NOT NULL,received_at INTEGER NOT NULL);
CREATE TABLE receipts(principal TEXT NOT NULL,method TEXT NOT NULL,path TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,status INTEGER NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),PRIMARY KEY(principal,method,path,key));
