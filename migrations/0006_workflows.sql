CREATE TABLE workflows (
 id TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
 project_id TEXT NOT NULL REFERENCES projects(id),
 name TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 created_at INTEGER NOT NULL
);
CREATE INDEX workflows_project ON workflows(project_id,created_at,id);
CREATE TABLE workflow_revisions (
 id TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
 workflow_id TEXT NOT NULL REFERENCES workflows(id),
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 nodes TEXT NOT NULL CHECK(json_valid(nodes)),
 edges TEXT NOT NULL CHECK(json_valid(edges)),
 digest TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)),
 created_at INTEGER NOT NULL,
 UNIQUE(workflow_id,revision)
);
CREATE INDEX workflow_revisions_workflow ON workflow_revisions(workflow_id,revision);
CREATE TRIGGER workflow_revisions_no_update BEFORE UPDATE ON workflow_revisions BEGIN SELECT RAISE(ABORT,'workflow_revision_immutable'); END;
CREATE TRIGGER workflow_revisions_no_delete BEFORE DELETE ON workflow_revisions BEGIN SELECT RAISE(ABORT,'workflow_revision_immutable'); END;
CREATE TRIGGER workflow_revisions_no_replace BEFORE INSERT ON workflow_revisions WHEN EXISTS(SELECT 1 FROM workflow_revisions WHERE id=NEW.id OR (workflow_id=NEW.workflow_id AND revision=NEW.revision)) BEGIN SELECT RAISE(ABORT,'workflow_revision_immutable'); END;
CREATE TABLE workflow_identities (
 workflow_id TEXT PRIMARY KEY NOT NULL REFERENCES workflows(id),
 digest TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body))
);
CREATE TABLE workflow_order_allocator (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 last_value INTEGER NOT NULL CHECK(typeof(last_value)='integer' AND last_value BETWEEN 0 AND 9007199254740991)
);
INSERT INTO workflow_order_allocator VALUES(1,0);
CREATE TABLE workflow_runs (
 id TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
 project_id TEXT NOT NULL REFERENCES projects(id),
 workflow_id TEXT NOT NULL REFERENCES workflows(id),
 plan_revision_id TEXT NOT NULL REFERENCES workflow_revisions(id),
 registration_order INTEGER NOT NULL UNIQUE CHECK(registration_order BETWEEN 1 AND 9007199254740991),
 state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','failed','cancelled','interrupted')),
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 last_sequence INTEGER NOT NULL CHECK(last_sequence BETWEEN 0 AND 9007199254740991),
 last_received_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 started_at INTEGER,
 ended_at INTEGER
);
CREATE UNIQUE INDEX workflow_runs_active ON workflow_runs(workflow_id) WHERE state IN ('queued','running');
CREATE INDEX workflow_runs_history ON workflow_runs(workflow_id,registration_order);
CREATE TABLE workflow_run_registrations (
 run_id TEXT PRIMARY KEY NOT NULL REFERENCES workflow_runs(id), digest TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body))
);
CREATE TABLE workflow_events (
 event_id TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
 workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
 type TEXT NOT NULL CHECK(type IN ('workflow.started','workflow.node.reported','workflow.heartbeat','workflow.succeeded','workflow.failed','workflow.cancelled')),
 digest TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)),
 acknowledgement TEXT NOT NULL CHECK(json_valid(acknowledgement)),
 occurred_at INTEGER NOT NULL,
 received_at INTEGER NOT NULL,
 UNIQUE(workflow_run_id,sequence)
);
CREATE TABLE workflow_node_observations (
 id TEXT PRIMARY KEY NOT NULL REFERENCES workflow_events(event_id),
 workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
 node_id TEXT NOT NULL,
 run_id TEXT REFERENCES runs(id),
 sequence INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)),
 UNIQUE(workflow_run_id,sequence)
);
CREATE INDEX workflow_node_history ON workflow_node_observations(workflow_run_id,node_id,sequence);
CREATE TABLE workflow_closures (
 id TEXT PRIMARY KEY NOT NULL,
 workflow_run_id TEXT NOT NULL UNIQUE REFERENCES workflow_runs(id),
 reason TEXT NOT NULL,
 actor TEXT NOT NULL CHECK(actor='operator'),
 created_at INTEGER NOT NULL
);
CREATE TRIGGER workflow_runs_binding_immutable BEFORE UPDATE OF id,project_id,workflow_id,plan_revision_id,registration_order ON workflow_runs WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.workflow_id IS NOT OLD.workflow_id OR NEW.plan_revision_id IS NOT OLD.plan_revision_id OR NEW.registration_order IS NOT OLD.registration_order BEGIN SELECT RAISE(ABORT,'workflow_run_binding_immutable'); END;
CREATE TRIGGER workflow_events_cross_kind BEFORE INSERT ON workflow_events WHEN EXISTS(SELECT 1 FROM run_events WHERE event_id=NEW.event_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'event_identity_conflict'); END;
CREATE TRIGGER run_events_cross_kind BEFORE INSERT ON run_events WHEN EXISTS(SELECT 1 FROM workflow_events WHERE event_id=NEW.event_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'event_identity_conflict'); END;
CREATE TRIGGER workflow_identities_no_update BEFORE UPDATE ON workflow_identities BEGIN SELECT RAISE(ABORT,'workflow_history_immutable'); END;
CREATE TRIGGER workflow_identities_no_delete BEFORE DELETE ON workflow_identities BEGIN SELECT RAISE(ABORT,'workflow_history_immutable'); END;
CREATE TRIGGER workflow_identities_no_replace BEFORE INSERT ON workflow_identities WHEN EXISTS(SELECT 1 FROM workflow_identities WHERE workflow_id=NEW.workflow_id) BEGIN SELECT RAISE(ABORT,'workflow_history_immutable'); END;
CREATE TRIGGER workflow_run_registrations_no_update BEFORE UPDATE ON workflow_run_registrations BEGIN SELECT RAISE(ABORT,'workflow_history_immutable'); END;
CREATE TRIGGER workflow_run_registrations_no_delete BEFORE DELETE ON workflow_run_registrations BEGIN SELECT RAISE(ABORT,'workflow_history_immutable'); END;
CREATE TRIGGER workflow_run_registrations_no_replace BEFORE INSERT ON workflow_run_registrations WHEN EXISTS(SELECT 1 FROM workflow_run_registrations WHERE run_id=NEW.run_id) BEGIN SELECT RAISE(ABORT,'workflow_history_immutable'); END;
CREATE TRIGGER workflow_events_no_update BEFORE UPDATE ON workflow_events BEGIN SELECT RAISE(ABORT,'workflow_history_immutable'); END;
CREATE TRIGGER workflow_events_no_delete BEFORE DELETE ON workflow_events BEGIN SELECT RAISE(ABORT,'workflow_history_immutable'); END;
CREATE TRIGGER workflow_events_no_replace BEFORE INSERT ON workflow_events WHEN EXISTS(SELECT 1 FROM workflow_events WHERE event_id=NEW.event_id) BEGIN SELECT RAISE(ABORT,'workflow_history_immutable'); END;
CREATE TRIGGER workflow_node_observations_no_update BEFORE UPDATE ON workflow_node_observations BEGIN SELECT RAISE(ABORT,'workflow_history_immutable'); END;
CREATE TRIGGER workflow_node_observations_no_delete BEFORE DELETE ON workflow_node_observations BEGIN SELECT RAISE(ABORT,'workflow_history_immutable'); END;
CREATE TRIGGER workflow_node_observations_no_replace BEFORE INSERT ON workflow_node_observations WHEN EXISTS(SELECT 1 FROM workflow_node_observations WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'workflow_history_immutable'); END;
CREATE TRIGGER workflow_closures_no_update BEFORE UPDATE ON workflow_closures BEGIN SELECT RAISE(ABORT,'workflow_history_immutable'); END;
CREATE TRIGGER workflow_closures_no_delete BEFORE DELETE ON workflow_closures BEGIN SELECT RAISE(ABORT,'workflow_history_immutable'); END;
CREATE TRIGGER workflow_closures_no_replace BEFORE INSERT ON workflow_closures WHEN EXISTS(SELECT 1 FROM workflow_closures WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'workflow_history_immutable'); END;
CREATE TRIGGER workflow_order_allocator_no_insert BEFORE INSERT ON workflow_order_allocator BEGIN SELECT RAISE(ABORT,'workflow_order_allocator_singleton'); END;
CREATE TRIGGER workflow_order_allocator_no_delete BEFORE DELETE ON workflow_order_allocator BEGIN SELECT RAISE(ABORT,'workflow_order_allocator_delete'); END;
CREATE TRIGGER workflow_order_allocator_advance BEFORE UPDATE ON workflow_order_allocator WHEN NEW.singleton IS NOT OLD.singleton OR typeof(NEW.last_value)!='integer' OR NEW.last_value<=OLD.last_value OR NEW.last_value>9007199254740991 BEGIN SELECT RAISE(ABORT,'workflow_order_allocator_advance'); END;
CREATE TRIGGER workflow_runs_order_insert BEFORE INSERT ON workflow_runs WHEN NEW.registration_order IS NULL OR typeof(NEW.registration_order)!='integer' OR NEW.registration_order<1 OR NEW.registration_order>9007199254740991 OR NEW.registration_order<=(SELECT last_value FROM workflow_order_allocator WHERE singleton=1) OR EXISTS(SELECT 1 FROM workflow_runs WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'workflow_registration_order_invalid'); END;
CREATE TRIGGER workflow_runs_order_advance AFTER INSERT ON workflow_runs BEGIN UPDATE workflow_order_allocator SET last_value=NEW.registration_order WHERE singleton=1; END;
