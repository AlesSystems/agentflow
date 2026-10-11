CREATE TABLE github_connection (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), repositories TEXT NOT NULL, version INTEGER NOT NULL,
 last_attempted_at INTEGER, last_fetched_at INTEGER, last_error TEXT, retry_not_before INTEGER
);
INSERT INTO github_connection VALUES(1,0,'[]',1,NULL,NULL,NULL,NULL);
CREATE TABLE github_pull_requests (
 repository TEXT NOT NULL, number INTEGER NOT NULL CHECK(number>0), url TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('open','closed')), draft INTEGER NOT NULL CHECK(draft IN (0,1)), head_sha TEXT NOT NULL, base_branch TEXT NOT NULL, merged_at TEXT, previous_head_sha TEXT,
 fetched_at INTEGER NOT NULL, last_attempted_at INTEGER NOT NULL, last_error TEXT, PRIMARY KEY(repository,number)
);
CREATE TABLE github_refresh_intents (
 principal TEXT NOT NULL CHECK(principal='operator'), method TEXT NOT NULL, path TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, request TEXT NOT NULL, generation TEXT NOT NULL, connection_version INTEGER NOT NULL, admitted_at INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','final')), completed_at INTEGER, result TEXT,
 PRIMARY KEY(principal,method,path,key)
);
CREATE TABLE github_lookup_attempts (
 repository TEXT NOT NULL, number INTEGER NOT NULL CHECK(number>0), attempted_at INTEGER NOT NULL, error TEXT, PRIMARY KEY(repository,number)
);
