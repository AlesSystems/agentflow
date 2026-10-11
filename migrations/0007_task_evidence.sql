ALTER TABLE tasks ADD COLUMN review_required INTEGER NOT NULL DEFAULT 0 CHECK(review_required IN (0,1));
ALTER TABLE tasks ADD COLUMN verification_required INTEGER NOT NULL DEFAULT 0 CHECK(verification_required IN (0,1));
ALTER TABLE tasks ADD COLUMN rework_round INTEGER NOT NULL DEFAULT 0 CHECK(rework_round>=0);
ALTER TABLE runs ADD COLUMN artifact_ref TEXT CHECK(artifact_ref IS NULL OR length(artifact_ref) BETWEEN 1 AND 2000);
ALTER TABLE runs ADD COLUMN rework_round INTEGER CHECK(rework_round IS NULL OR rework_round>=0);
CREATE TABLE task_dependencies (
 task_id TEXT NOT NULL, prerequisite_id TEXT NOT NULL, project_id TEXT NOT NULL,
 PRIMARY KEY(task_id,prerequisite_id), CHECK(task_id<>prerequisite_id),
 FOREIGN KEY(task_id,project_id) REFERENCES tasks(id,project_id),
 FOREIGN KEY(prerequisite_id,project_id) REFERENCES tasks(id,project_id)
);
CREATE INDEX task_dependencies_project ON task_dependencies(project_id,task_id);
CREATE INDEX task_dependencies_prerequisite ON task_dependencies(prerequisite_id,task_id);
CREATE TABLE task_artifacts (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), run_id TEXT REFERENCES runs(id),
 work_revision INTEGER NOT NULL CHECK(work_revision>0), artifact_ref TEXT NOT NULL CHECK(length(artifact_ref) BETWEEN 1 AND 2000),
 rework_round INTEGER NOT NULL CHECK(rework_round>=0), actor TEXT NOT NULL CHECK(actor IN ('operator','reporter')),
 display_url TEXT, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX task_artifacts_tuple ON task_artifacts(task_id,work_revision,rework_round);
CREATE INDEX task_artifacts_current ON task_artifacts(task_id,work_revision,rework_round,created_at,id);
CREATE TABLE gate_decisions (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), run_id TEXT NOT NULL REFERENCES runs(id),
 event_id TEXT NOT NULL UNIQUE REFERENCES run_events(event_id), work_revision INTEGER NOT NULL CHECK(work_revision>0),
 artifact_ref TEXT NOT NULL CHECK(length(artifact_ref) BETWEEN 1 AND 2000), rework_round INTEGER NOT NULL CHECK(rework_round>=0),
 purpose TEXT NOT NULL CHECK(purpose IN ('review','verification')), decision TEXT NOT NULL CHECK(decision IN ('approved','changes_requested')),
 evidence_note TEXT NOT NULL CHECK(length(evidence_note) BETWEEN 1 AND 4000), created_at INTEGER NOT NULL
);
CREATE INDEX gate_decisions_current ON gate_decisions(task_id,work_revision,artifact_ref,rework_round,purpose,decision,created_at,id);
CREATE TABLE task_reworks (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), work_revision INTEGER NOT NULL CHECK(work_revision>0),
 rework_round INTEGER NOT NULL CHECK(rework_round>0), reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 4000),
 actor TEXT NOT NULL CHECK(actor='operator'), created_at INTEGER NOT NULL
);
CREATE INDEX task_reworks_history ON task_reworks(task_id,created_at,id);
CREATE TRIGGER task_artifacts_no_update BEFORE UPDATE ON task_artifacts BEGIN SELECT RAISE(ABORT,'task_evidence_immutable'); END;
CREATE TRIGGER task_artifacts_no_delete BEFORE DELETE ON task_artifacts BEGIN SELECT RAISE(ABORT,'task_evidence_immutable'); END;
CREATE TRIGGER task_artifacts_no_replace BEFORE INSERT ON task_artifacts WHEN EXISTS(SELECT 1 FROM task_artifacts WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'task_evidence_immutable'); END;
CREATE TRIGGER gate_decisions_no_update BEFORE UPDATE ON gate_decisions BEGIN SELECT RAISE(ABORT,'task_evidence_immutable'); END;
CREATE TRIGGER gate_decisions_no_delete BEFORE DELETE ON gate_decisions BEGIN SELECT RAISE(ABORT,'task_evidence_immutable'); END;
CREATE TRIGGER gate_decisions_no_replace BEFORE INSERT ON gate_decisions WHEN EXISTS(SELECT 1 FROM gate_decisions WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'task_evidence_immutable'); END;
CREATE TRIGGER task_reworks_no_update BEFORE UPDATE ON task_reworks BEGIN SELECT RAISE(ABORT,'task_evidence_immutable'); END;
CREATE TRIGGER task_reworks_no_delete BEFORE DELETE ON task_reworks BEGIN SELECT RAISE(ABORT,'task_evidence_immutable'); END;
CREATE TRIGGER task_reworks_no_replace BEFORE INSERT ON task_reworks WHEN EXISTS(SELECT 1 FROM task_reworks WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'task_evidence_immutable'); END;
CREATE TRIGGER runs_evidence_immutable BEFORE UPDATE OF artifact_ref,rework_round ON runs WHEN NEW.artifact_ref IS NOT OLD.artifact_ref OR NEW.rework_round IS NOT OLD.rework_round BEGIN SELECT RAISE(ABORT,'run_evidence_immutable'); END;
CREATE TRIGGER runs_evidence_tuple BEFORE INSERT ON runs WHEN (NEW.artifact_ref IS NULL)<>(NEW.rework_round IS NULL) OR (NEW.artifact_ref IS NOT NULL AND NEW.purpose NOT IN ('review','verification')) BEGIN SELECT RAISE(ABORT,'run_evidence_tuple'); END;
