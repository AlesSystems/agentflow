CREATE TABLE instance_metadata (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  generation TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK(schema_version >= 1)
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE,
  principal TEXT NOT NULL CHECK(principal = 'operator'),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
