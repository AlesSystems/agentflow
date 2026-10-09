# Backend architecture

Status: proposed implementation contract. [API.md](API.md) defines the transport. This document owns domain and persistence rules.

## Domain model

IDs are opaque UUIDs. Dates use UTC in storage. Client timestamps never decide state order. `version` is an integer used for optimistic concurrency. `workRevision` changes only when the task's work or acceptance criteria change, when it is reopened, or when a new implementation attempt is registered.

| Record | Important fields and relationships |
| --- | --- |
| Project | `id`, `name`, optional `repositoryPath`, `archivedAt`, `version` |
| Task | `id`, `projectId`, optional `parentTaskId`, title, description, acceptance criteria, status, priority, tags, optional assigned agent and target role, branch, PR URL, `blockedReason`, `version`, `workRevision`, timestamps |
| Agent | Stable `id`, display name, source, default role, `version`; no stored online flag |
| Run | `id`, `projectId`, `agentId`, optional `taskId`, purpose, model label, `workRevision`, state, `lastSequence`, `lastReceivedAt`, start/end times, `version` |
| Run event | `eventId`, `runId`, sequence, type, payload, canonical request digest, occurrence time, receipt time |
| Task comment | `id`, `taskId`, text, actor, creation time |
| Completion | `id`, `taskId`, accepted work revision, optional implementation run, human actor, evidence note, optional evidence URL, accepted time |
| Change | Monotonic `cursor`, entity type and ID, project ID when applicable, change kind, receipt time |
| Request receipt | Idempotency key, principal, method/path, canonical request digest, committed response |
| Session | Hashed session secret, stable operator principal, expiry; pairing and reporter tokens are stored separately |
| Settings | Selected IANA timezone and `version` |
| Instance metadata | Database `generation` UUID and schema metadata |

Projects, tasks, agents, runs, and settings start at `version=1`. Each accepted mutation of a versioned record increments its version once, including metadata edits and manual run closure. Run registration and events additionally update linked task versions as specified below. Exact retries increment nothing. Comments and completions are immutable records and do not increment task version except for the completion state transition.

Foreign keys prevent orphaned records. Parent tasks must belong to the same project, cannot reference themselves, and cannot introduce cycles. Parentage is grouping only in v0.1; it does not imply dependency or automatic completion. Agent assignment expresses intent and does not prove execution.

Priorities are `low`, `normal`, `high`, and `urgent`. Roles are `orchestrator`, `implementation`, `reviewer`, and `verifier`. A run's purpose is `planning`, `implementation`, `review`, or `verification`; it is recorded per attempt rather than inferred from an agent's current role. One agent identity may report many runs.

## Task lifecycle

The board has four fixed statuses.

| Status | Meaning |
| --- | --- |
| `backlog` | Work has not started, or a human returned it to the queue |
| `in_progress` | Work is underway, either manually or through a reported implementation run |
| `review` | Work awaits human review and acceptance |
| `completed` | A human recorded acceptance for the current work revision |

`blockedReason` is an overlay, not a fifth status. A failed execution is an outcome on a run, not a task column.

Manual moves among the first three statuses require the current task version and no queued or running run on that task. Registering any task-linked run increments task `version`. Registering an implementation run also increments `workRevision`; `run.started` moves the task to `in_progress`, and `run.succeeded` moves it to `review`. Both transitions increment task version. Failure, cancellation, or interruption leaves the column unchanged and adds an attention signal.

A completed task rejects edits and new runs until it is reopened. Reopen moves it to `backlog`, increments both revisions, and clears the current completion timestamp. Historical completion records remain immutable.

Description and acceptance-criteria edits increment both revisions. Title, tags, priority, assignee, parent grouping, links, and blocker edits increment only `version`. Work edits are rejected while a run is queued or running. Editing the work of a task in `review` returns it to `backlog`; its earlier execution evidence remains visible.

Completion is a distinct command. It requires `review`, the current task version, no queued or running run, and a nonempty human acceptance note. If the task has any implementation-run history, its latest implementation run must have succeeded for the current work revision. A task with no implementation-run history can be accepted as manual work. The UI labels both paths as human acceptance.

Review and verification run outcomes appear as evidence for the human. A successful test process does not prove that its assertions passed, and AgentFlow does not inspect linked evidence. Automatic policy enforcement is deferred to Phase 3. Only a browser session can complete or reopen a task in v0.1; harness credentials cannot claim human acceptance.

## Run lifecycle and concurrent work

A registered run begins in `queued`. It can transition to `running`, then `succeeded`, `failed`, or `cancelled`. A queued run may become `cancelled` before it starts. Terminal outcomes never change. A retry or resumed execution uses a new run ID. Each accepted event increments run `version`; an exact retry changes no version.

At most one queued or running run references a task in v0.1. A partial unique index enforces that rule. Parallel implementation uses separate tasks grouped by a parent. This bounds automatic card movement without preventing parallel agents across a project. Planning runs may omit `taskId`; other purposes require it. Task, run, and project references must agree.

A browser user can close a stale run record with a reason, producing terminal state `interrupted`. This changes tracking only and never signals the external process. The confirmation explains that the process may still be executing. Further reports for that run are rejected; a surviving producer needs a new run ID.

Harnesses send a heartbeat every 15 seconds while a run is active. Registration initializes `lastReceivedAt` to server registration time. A queued run with `lastSequence=0` displays "No report received." More than 60 seconds without a new accepted report makes the observation stale, including a queued run that never starts. Staleness is computed from server receipt time and is separate from persisted run state. A stale run is not declared dead or failed. Duplicate retries do not refresh its last-seen time.

## Event ingestion

The chosen delivery policy is ordered, at-least-once reporting per run. Each producer uses a durable outbox and a single sequence allocator for its run. Independent agents use independent run IDs. The server does not infer ordering from clocks or buffer sequence gaps.

For each event, one short write transaction performs these steps.

1. Resolve an existing `eventId`. An identical canonical body returns the original receipt. A changed body returns `409 idempotency_conflict`.
2. Require the registered run and `sequence = lastSequence + 1`. A future sequence returns `409 sequence_gap` with `expectedSequence`. A reused sequence with another event ID returns `409 sequence_conflict`.
3. Check the typed payload and legal state transition. A terminal run rejects new reports with `409 run_terminal`.
4. Insert the event, update the run and any permitted task transition, and append entity changes.
5. Store the acknowledgement and commit. Only then respond.

Validation and authentication happen before the transaction. Exact duplicate events are resolved before current-state checks, so a lost response can be retried after the run terminates. Request digests use canonical JSON with sorted object keys; JSON whitespace is irrelevant.

A crash before commit leaves no accepted event. A crash after commit but before the response permits a retry to recover the same acknowledgement. Missing earlier events must be resent from the outbox. If that data is lost, the user closes the stale run record and the harness registers a new attempt. These are implementation acceptance cases, not behavior already tested.

## SQLite and migrations

Drizzle schema and reviewed SQL migrations define the database. Connections enable foreign keys, WAL, `synchronous=FULL`, and a bounded 250 ms busy timeout. The target deliberately favors acknowledged-write durability. Busy contention returns a retryable `503 database_busy`, not an unbounded wait.

SQLite WAL supports readers during writes while retaining one writer at a time. Keep transactions short and on local storage. SSE streams must never retain a read transaction. [SQLite WAL](https://sqlite.org/wal.html).

Index task lists by project/status/update time/ID, runs by task and agent/receipt time, events uniquely by ID and run/sequence, and changes by cursor. Paginate history and query only the visible board. JSON payloads have bounded size; full transcripts and token-by-token output are excluded.

Startup takes the instance lock, backs up an existing database, applies pending migrations transactionally where supported, and serves requests only after success. Failure leaves the service unavailable with a repair message. Restoration happens with the service stopped, preserves the damaged database for investigation, renews the database generation, and invalidates all browser sessions. It must not revive sessions retained in the backup.

Backups use the SQLite backup API, then run an integrity check. Copying only the database file while WAL writes are active is not the backup procedure. [SQLite backup API](https://sqlite.org/backup.html), [better-sqlite3 backup API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md).

v0.1 retains events, changes, and idempotency receipts. There is no automatic pruning or hard-delete endpoint. Storage growth is visible in Settings and tested in P07. Retention and exports require a later migration and cursor-expiry policy.

## Durable browser updates

A data snapshot returns records and `snapshotCursor` from the same read transaction. The browser opens SSE after that cursor. The server polls committed changes in batches of 100, initially every 500 ms, and releases each query immediately. This avoids correctness dependence on an in-memory event emitter or framework hot reload.

SSE messages contain changed entity IDs, not private log bodies. The browser invalidates affected queries and reads current state. One connection serves each browser tab. The server sends a keepalive comment every 15 seconds and disconnects slow clients rather than building an unbounded queue. Limits begin at 20 connections and 1 MiB queued bytes per connection; P05 measures and adjusts them.

The stream uses each change cursor as its SSE ID. Reconnects replay committed changes after `Last-Event-ID`. A database restore or an invalid/out-of-range cursor yields `reset`, causing a fresh snapshot. Snapshots include a database `generation` UUID. Every authenticated HTTP response also carries the current UUID in `AgentFlow-Generation`. Stored acknowledgement bodies retain historical metadata; clients compare the response header before using them. Restore generates a new UUID so a reused numeric cursor cannot hide lost history. [SSE behavior](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).

## Local authentication and privacy

The launcher explicitly binds to `127.0.0.1`. Host headers must match `localhost:<port>` or `127.0.0.1:<port>`. It does not trust forwarded headers. Network exposure and LAN mode are unsupported.

First run creates separate random 256-bit pairing and reporter tokens in user-only files. The operator copies the pairing token from the local setup command into the browser pairing form. `POST /api/v1/session` accepts only the pairing token and exchanges it for a random, hashed-at-rest session with a 12-hour expiry. Cookies use HttpOnly, SameSite=Strict, and Path=/; local HTTP cannot require Secure. Tokens never appear in URLs or browser storage. The local credential-rotation command renews both tokens and invalidates all sessions.

All project data, server-rendered private pages, and SSE require authentication. CLI requests use the reporter token with `Authorization: Bearer`. Pairing tokens are invalid as bearer credentials. Reporter tokens cannot create sessions or call human-only commands. Stable principals are `operator` and `reporter`, so receipt lookup survives session renewal and token rotation after authentication. Cookie-authenticated mutations require an exact allowed Origin and JSON content type. All supplied Origin headers must match the allowed origin set, including bearer requests. Origin-less mutations require bearer authentication. Cookie-authenticated reads and page navigation accept same-origin or direct-navigation Fetch Metadata, and reject cross-site requests. Health checks are public. Browser pairing also requires an allowed Origin. No permissive CORS headers are sent.

Request bodies are limited to 64 KiB. Progress text is limited to 4,000 characters. Titles are limited to 200, descriptions to 20,000, and acceptance criteria to 8,000. Invalid or oversized data is rejected before storage. Error responses omit stack traces, secrets, and raw filesystem details.

Hook text is untrusted text, never HTML. Repository paths and evidence paths are metadata only. The server does not execute or open them. URL fields allow only `https:` or `http:` links and never trigger server-side fetching. The harness must omit secrets and full prompts before reporting. Redaction patterns alone cannot guarantee secrecy.

This protects against unintended network access and hostile browser origins. It does not protect data from another program running with the same operating-system user privileges.
