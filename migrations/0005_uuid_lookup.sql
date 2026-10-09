CREATE INDEX projects_id_case ON projects(id COLLATE NOCASE);
CREATE INDEX tasks_id_case ON tasks(id COLLATE NOCASE);
CREATE INDEX agents_id_case ON agents(id COLLATE NOCASE);
CREATE INDEX runs_id_case ON runs(id COLLATE NOCASE);
CREATE INDEX run_events_id_case ON run_events(event_id COLLATE NOCASE);
