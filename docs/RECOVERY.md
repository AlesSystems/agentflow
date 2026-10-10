# Local setup and recovery

Use Node 24.15.0 and npm 11.12.1. On the tested macOS 27.0 arm64 host,
`npm ci --foreground-scripts` installed the committed lockfile and `npm run build`
created ordinary production assets. Installation needs network access; the running
application uses local assets and system fonts. Google Chrome is needed only for
the recorded Chrome verification. A native SQLite installation may require the
host's build tools if a compatible prebuilt addon is unavailable.

Choose absolute, canonical, disjoint application, data, outbox and backup paths.
Data, credentials and outbox belong outside the application checkout. Use owned
0700 directories and 0600 credential files. Do not use a symlink alias as a path.
Run `npm run local -- setup` in your local interactive terminal while stopped.
Keep its two tokens private. Enter the pairing token in the local pairing form;
put the separate reporter token in a protected token file for the CLI described
in [CLI.md](CLI.md). Tokens never belong in URLs, command arguments or shell history.

Start with `npm start`. The service binds only IPv4 loopback. A second instance,
unsafe filesystem permissions, an interrupted restore, or an incompatible schema
fails closed. Direct `next start` does not initialize the owned runtime.

## A migration fails before startup

Keep the service stopped. Preserve the complete data directory, credentials,
automatic `backups/pre-migration-*.sqlite` files and the error message. Do not
remove migration history, edit shipping migrations, or delete lock/database files
as a repair. The runtime validates SQL before migration; a transactional SQL
failure rolls back that migration's changes and leaves a verified pre-migration
backup. A validation rejection can occur earlier and need not create a backup.
The transactional failure fixture verifies original rows, generation, checksums,
backup integrity and absence of a listener through the failing subprocess.

Return to a compatible reviewed source/build and start normally. If a known
verified backup is required, use the stopped restore procedure below. Escalate an
unknown checksum/schema error with the preserved evidence rather than guessing
which migration records to change.

## Backup and restore while stopped

Stop every service process using this data directory, then run:

```sh
npm run local -- backup --output /absolute/protected/backups/snapshot.sqlite
npm run local -- restore --from /absolute/protected/backups/snapshot.sqlite
npm start
```

Backup refuses an existing destination and verifies SQLite integrity and foreign
keys. Restore verifies its input, preserves the displaced database and sidecars in
a damaged bundle, changes generation and revokes all browser sessions. Keep the
current external credentials separately; the SQLite backup excludes them. Each
browser must pair again. A retained historical receipt can describe the old
generation while the response header identifies the current generation.

If restore was interrupted, remain stopped and run
`npm run local -- restore repair`. Preserve the marker and damaged bundle when
repair fails. Never copy only the main file from a live WAL-mode database.

## Outboxes after restore

Run a fresh `agentflow flush` using the same protected token file, service and
outbox. An exact queued event whose committed prefix survives the backup can
recover its original receipt without adding another event. The CLI preserves
IDs, sequence, body, digest and acknowledgement watermarks.

Restore cannot recover a discarded acknowledged prefix. If the server asks for a
sequence absent from the retained outbox, flush exits 3 and retains the original
bytes. A healthy independent run can still progress in the same flush. Preserve
blocked records and the damaged database for operator reconciliation. Do not
renumber, regenerate, silently remap or delete observations. Work whose run or
project is absent from the backup also needs explicit repair. Exit 2 means durable
pending delivery; exit 3 requires repair; neither means the observation vanished.

AgentFlow observes externally started agents. A stale report means execution is
uncertain. Success moves implementation work to Review; completion remains a
browser human-session command. Automated checkpoint acceptance is synthetic test
evidence and never a human attestation.
