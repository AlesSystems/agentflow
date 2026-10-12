CREATE TABLE run_events_new (
 event_id TEXT PRIMARY KEY NOT NULL,
 run_id TEXT NOT NULL REFERENCES runs(id),
 sequence INTEGER NOT NULL CHECK(typeof(sequence)='integer' AND sequence BETWEEN 1 AND 9007199254740991),
 type TEXT NOT NULL CHECK(type IN ('run.started','run.heartbeat','run.progress','run.succeeded','run.failed','run.cancelled','run.usage')),
 digest TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)),
 acknowledgement TEXT NOT NULL CHECK(json_valid(acknowledgement)),
 occurred_at INTEGER NOT NULL,
 received_at INTEGER NOT NULL,
 payload_pruned_at INTEGER CHECK(payload_pruned_at IS NULL OR (typeof(payload_pruned_at)='integer' AND payload_pruned_at BETWEEN 0 AND 8640000000000000)),
 UNIQUE(run_id,sequence)
);
INSERT INTO run_events_new(rowid,event_id,run_id,sequence,type,digest,body,acknowledgement,occurred_at,received_at,payload_pruned_at)
 SELECT rowid,event_id,run_id,sequence,type,digest,body,acknowledgement,occurred_at,received_at,payload_pruned_at FROM run_events;
DROP VIEW retention_eligible_events;
DROP TRIGGER workflow_events_cross_kind;
DROP TABLE run_events;
ALTER TABLE run_events_new RENAME TO run_events;
CREATE INDEX run_events_id_case ON run_events(event_id COLLATE NOCASE);
CREATE INDEX run_events_retention ON run_events(received_at,event_id) WHERE payload_pruned_at IS NULL AND type IN ('run.progress','run.heartbeat');
CREATE VIEW retention_eligible_events AS
 SELECT e.* FROM run_events e JOIN runs r ON r.id=e.run_id
 WHERE e.payload_pruned_at IS NULL AND e.type IN ('run.progress','run.heartbeat')
 AND json_type(e.body,'$.payload') IS 'object'
 AND r.state IN ('succeeded','failed','cancelled','interrupted')
 AND NOT EXISTS(SELECT 1 FROM completions WHERE implementation_run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM task_artifacts WHERE run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM gate_decisions g WHERE g.run_id=r.id OR g.event_id IN (SELECT event_id FROM run_events WHERE run_id=r.id))
 AND NOT EXISTS(SELECT 1 FROM workflow_node_observations WHERE run_id=r.id);
CREATE TRIGGER run_events_no_delete BEFORE DELETE ON run_events BEGIN SELECT RAISE(ABORT,'run_event_immutable'); END;
CREATE TRIGGER run_events_no_replace BEFORE INSERT ON run_events WHEN EXISTS(SELECT 1 FROM run_events WHERE event_id=NEW.event_id OR (run_id=NEW.run_id AND sequence=NEW.sequence)) BEGIN SELECT RAISE(ABORT,'run_event_immutable'); END;
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
CREATE TRIGGER workflow_events_cross_kind BEFORE INSERT ON workflow_events WHEN EXISTS(SELECT 1 FROM run_events WHERE event_id=NEW.event_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'event_identity_conflict'); END;
CREATE TRIGGER run_events_cross_kind BEFORE INSERT ON run_events WHEN EXISTS(SELECT 1 FROM workflow_events WHERE event_id=NEW.event_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'event_identity_conflict'); END;
CREATE TABLE usage_measurements (
 run_id TEXT NOT NULL REFERENCES runs(id),
 usage_id TEXT NOT NULL CHECK(length(usage_id) BETWEEN 1 AND 200),
 event_id TEXT NOT NULL UNIQUE REFERENCES run_events(event_id),
 payload_digest TEXT NOT NULL,
 source TEXT NOT NULL CHECK(length(source) BETWEEN 1 AND 200),
 model TEXT NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
 input_tokens INTEGER CHECK(input_tokens IS NULL OR (typeof(input_tokens)='integer' AND input_tokens BETWEEN 0 AND 9007199254740991)),
 output_tokens INTEGER CHECK(output_tokens IS NULL OR (typeof(output_tokens)='integer' AND output_tokens BETWEEN 0 AND 9007199254740991)),
 billing_basis TEXT CHECK(billing_basis IS NULL OR billing_basis IN ('input_output_only','unrepresented')),
 measured_at INTEGER NOT NULL CHECK(typeof(measured_at)='integer' AND measured_at BETWEEN -8640000000000000 AND 8640000000000000),
 first_received_at INTEGER NOT NULL CHECK(typeof(first_received_at)='integer' AND first_received_at BETWEEN 0 AND 8640000000000000),
 PRIMARY KEY(run_id,usage_id)
);
CREATE INDEX usage_receipt ON usage_measurements(first_received_at,run_id,usage_id);
CREATE TRIGGER usage_no_update BEFORE UPDATE ON usage_measurements BEGIN SELECT RAISE(ABORT,'usage_immutable'); END;
CREATE TRIGGER usage_no_delete BEFORE DELETE ON usage_measurements BEGIN SELECT RAISE(ABORT,'usage_immutable'); END;
CREATE TRIGGER usage_no_replace BEFORE INSERT ON usage_measurements WHEN EXISTS(SELECT 1 FROM usage_measurements WHERE (run_id=NEW.run_id AND usage_id=NEW.usage_id) OR event_id=NEW.event_id) BEGIN SELECT RAISE(ABORT,'usage_immutable'); END;
CREATE TRIGGER usage_parent_binding BEFORE INSERT ON usage_measurements
 WHEN NOT EXISTS(SELECT 1 FROM run_events e WHERE e.event_id=NEW.event_id AND e.run_id=NEW.run_id AND e.type='run.usage'
 AND e.received_at=NEW.first_received_at
 AND json_extract(e.body,'$.payload.usageId') IS NEW.usage_id
 AND json_extract(e.body,'$.payload.source') IS NEW.source
 AND json_extract(e.body,'$.payload.model') IS NEW.model
 AND json_extract(e.body,'$.payload.inputTokens') IS NEW.input_tokens
 AND json_extract(e.body,'$.payload.outputTokens') IS NEW.output_tokens
 AND json_extract(e.body,'$.payload.billingBasis') IS NEW.billing_basis
 AND CAST(round((julianday(json_extract(e.body,'$.payload.measuredAt'))-2440587.5)*86400000) AS INTEGER)=NEW.measured_at)
 BEGIN SELECT RAISE(ABORT,'usage_parent_invalid'); END;
