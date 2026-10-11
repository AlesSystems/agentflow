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
