CREATE TABLE run_registrations (
 run_id TEXT PRIMARY KEY NOT NULL REFERENCES runs(id),
 digest TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body))
);
CREATE TABLE run_events (
 event_id TEXT PRIMARY KEY NOT NULL,
 run_id TEXT NOT NULL REFERENCES runs(id),
 sequence INTEGER NOT NULL CHECK(typeof(sequence)='integer' AND sequence BETWEEN 1 AND 9007199254740991),
 type TEXT NOT NULL CHECK(type IN ('run.started','run.heartbeat','run.progress','run.succeeded','run.failed','run.cancelled')),
 digest TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)),
 acknowledgement TEXT NOT NULL CHECK(json_valid(acknowledgement)),
 occurred_at INTEGER NOT NULL,
 received_at INTEGER NOT NULL,
 UNIQUE(run_id,sequence)
);
CREATE TABLE run_closures (
 id TEXT PRIMARY KEY NOT NULL,
 run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
 reason TEXT NOT NULL,
 actor TEXT NOT NULL CHECK(actor='operator'),
 created_at INTEGER NOT NULL
);
CREATE TRIGGER run_registrations_no_update BEFORE UPDATE ON run_registrations BEGIN SELECT RAISE(ABORT,'run_registration_immutable'); END;
CREATE TRIGGER run_registrations_no_delete BEFORE DELETE ON run_registrations BEGIN SELECT RAISE(ABORT,'run_registration_immutable'); END;
CREATE TRIGGER run_registrations_no_replace BEFORE INSERT ON run_registrations WHEN EXISTS(SELECT 1 FROM run_registrations WHERE run_id=NEW.run_id) BEGIN SELECT RAISE(ABORT,'run_registration_immutable'); END;
CREATE TRIGGER run_events_no_update BEFORE UPDATE ON run_events BEGIN SELECT RAISE(ABORT,'run_event_immutable'); END;
CREATE TRIGGER run_events_no_delete BEFORE DELETE ON run_events BEGIN SELECT RAISE(ABORT,'run_event_immutable'); END;
CREATE TRIGGER run_events_no_replace BEFORE INSERT ON run_events WHEN EXISTS(SELECT 1 FROM run_events WHERE event_id=NEW.event_id OR (run_id=NEW.run_id AND sequence=NEW.sequence)) BEGIN SELECT RAISE(ABORT,'run_event_immutable'); END;
CREATE TRIGGER run_closures_no_update BEFORE UPDATE ON run_closures BEGIN SELECT RAISE(ABORT,'run_closure_immutable'); END;
CREATE TRIGGER run_closures_no_delete BEFORE DELETE ON run_closures BEGIN SELECT RAISE(ABORT,'run_closure_immutable'); END;
CREATE TRIGGER run_closures_no_replace BEFORE INSERT ON run_closures WHEN EXISTS(SELECT 1 FROM run_closures WHERE id=NEW.id OR run_id=NEW.run_id) BEGIN SELECT RAISE(ABORT,'run_closure_immutable'); END;
