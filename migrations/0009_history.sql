ALTER TABLE run_events ADD COLUMN payload_pruned_at INTEGER CHECK(payload_pruned_at IS NULL OR (typeof(payload_pruned_at)='integer' AND payload_pruned_at BETWEEN 0 AND 8640000000000000));
CREATE TABLE retention_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991));
INSERT INTO retention_state VALUES(1,1);
CREATE TABLE retention_previews(
 id TEXT PRIMARY KEY NOT NULL, principal TEXT NOT NULL CHECK(principal='operator'), cutoff INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, generation TEXT NOT NULL, version INTEGER NOT NULL, digest TEXT NOT NULL,
 candidates TEXT NOT NULL CHECK(json_valid(candidates)), issued_at INTEGER NOT NULL
);
CREATE TABLE retention_consumptions(preview_id TEXT PRIMARY KEY NOT NULL REFERENCES retention_previews(id));
CREATE TRIGGER retention_previews_no_update BEFORE UPDATE ON retention_previews BEGIN SELECT RAISE(ABORT,'retention_preview_immutable'); END;
CREATE TRIGGER retention_previews_no_replace BEFORE INSERT ON retention_previews WHEN EXISTS(SELECT 1 FROM retention_previews WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'retention_preview_immutable'); END;
CREATE TRIGGER retention_consumptions_no_update BEFORE UPDATE ON retention_consumptions BEGIN SELECT RAISE(ABORT,'retention_consumption_immutable'); END;
CREATE TRIGGER retention_consumptions_no_delete BEFORE DELETE ON retention_consumptions BEGIN SELECT RAISE(ABORT,'retention_consumption_immutable'); END;
CREATE TRIGGER retention_consumptions_no_replace BEFORE INSERT ON retention_consumptions WHEN EXISTS(SELECT 1 FROM retention_consumptions WHERE preview_id=NEW.preview_id) BEGIN SELECT RAISE(ABORT,'retention_consumption_immutable'); END;
CREATE VIEW retention_eligible_events AS
 SELECT e.* FROM run_events e JOIN runs r ON r.id=e.run_id
 WHERE e.payload_pruned_at IS NULL AND e.type IN ('run.progress','run.heartbeat')
 AND json_type(e.body,'$.payload') IS 'object'
 AND r.state IN ('succeeded','failed','cancelled','interrupted')
 AND NOT EXISTS(SELECT 1 FROM completions WHERE implementation_run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM task_artifacts WHERE run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM gate_decisions g WHERE g.run_id=r.id OR g.event_id IN (SELECT event_id FROM run_events WHERE run_id=r.id))
 AND NOT EXISTS(SELECT 1 FROM workflow_node_observations WHERE run_id=r.id);
DROP TRIGGER run_events_no_update;
CREATE TRIGGER run_events_no_update BEFORE UPDATE ON run_events
 WHEN NOT (
 OLD.payload_pruned_at IS NULL AND NEW.payload_pruned_at IS NOT NULL
 AND NEW.event_id IS OLD.event_id AND NEW.run_id IS OLD.run_id AND NEW.sequence IS OLD.sequence
 AND NEW.type IS OLD.type AND NEW.digest IS OLD.digest AND NEW.acknowledgement IS OLD.acknowledgement
 AND NEW.occurred_at IS OLD.occurred_at AND NEW.received_at IS OLD.received_at
 AND NEW.body IS json_set(OLD.body,'$.payload',NULL)
 AND json_type(OLD.body,'$.payload') IS 'object'
 AND EXISTS(SELECT 1 FROM retention_eligible_events WHERE event_id=OLD.event_id)
 )
 BEGIN SELECT RAISE(ABORT,'run_event_immutable'); END;
CREATE TRIGGER run_events_intact_insert BEFORE INSERT ON run_events
 WHEN NEW.payload_pruned_at IS NOT NULL OR json_type(NEW.body,'$.payload') IS NOT 'object' OR json_type(NEW.body,'$.payloadPrunedAt') IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'run_event_intact_required'); END;
CREATE INDEX retention_preview_expiry ON retention_previews(principal,expires_at);
CREATE INDEX run_events_retention ON run_events(received_at,event_id) WHERE payload_pruned_at IS NULL AND type IN ('run.progress','run.heartbeat');
