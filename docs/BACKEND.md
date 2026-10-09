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
| Session | Hashed session secret, stable operator principal, expiry; pairing and reporter tokens have separate authority in one protected external credentials file |
| Settings | Selected IANA timezone and `version` |
| Instance metadata | Database `generation` UUID and schema metadata |

Projects, tasks, agents, runs, and settings start at `version=1`. Each accepted mutation of a versioned record increments its version once, including metadata edits and manual run closure. Run registration and events additionally update linked task versions as specified below. Exact retries increment nothing. Comments and completions are immutable records and do not increment task version except for the completion state transition.

Foreign keys prevent orphaned records. Parent tasks must belong to the same project, cannot reference themselves, and cannot introduce cycles. Parentage is grouping only in v1; it does not imply dependency or automatic completion. Agent assignment expresses intent and does not prove execution.

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

A completed task rejects work/metadata edits and new runs until it is reopened. Immutable comments may append in an unarchived project without changing task revisions or current acceptance. Reopen moves it to `backlog`, increments both revisions, and clears the current completion timestamp. Historical completion records remain immutable.

Changed description and acceptance-criteria values increment both revisions. Supplying unchanged values does not change workRevision. Title, tags, priority, assignee, parent grouping, links, and blocker edits increment only `version`. Work edits are rejected while a run is queued or running. Editing the work of a task in `review` returns it to `backlog`; its earlier execution evidence remains visible.

Completion is a distinct command. It requires `review`, the current task version, no queued or running run, and a nonempty human acceptance note. If the task has any implementation-run history, its latest implementation run must have succeeded for the current work revision. A task with no implementation-run history can be accepted as manual work. The UI labels both paths as human acceptance.

Review and verification run outcomes appear as evidence for the human. A successful test process does not prove that its assertions passed, and AgentFlow does not inspect linked evidence. W02 adds configured revision-bound evidence gates under [V1_WORKFLOWS.md](V1_WORKFLOWS.md); these never automatically complete tasks. Only a browser session can complete or reopen a task in v1; harness credentials cannot claim human acceptance.

## Run lifecycle and concurrent work

A registered run begins in `queued`. It can transition to `running`, then `succeeded`, `failed`, or `cancelled`. A queued run may become `cancelled` before it starts. Terminal outcomes never change. A retry or resumed execution uses a new run ID. Each accepted event increments run `version`; an exact retry changes no version.

At most one queued or running run references a task in v1. A partial unique index enforces that rule. Parallel implementation uses separate tasks grouped by a parent. This bounds automatic card movement without preventing parallel agents across a project. Planning runs may omit `taskId`; other purposes require it. Task, run, and project references must agree.

A browser user can close a stale run record with a reason, producing terminal state `interrupted`. This changes tracking only and never signals the external process. The confirmation explains that the process may still be executing. Further reports for that run are rejected; a surviving producer needs a new run ID.

Harnesses send a heartbeat every 15 seconds while a run is running. Queued runs reject heartbeats; their permitted events are start or cancellation. Registration initializes `lastReceivedAt` to server registration time. A queued run with `lastSequence=0` displays "No report received." More than 60 seconds without a new accepted report makes the observation stale, including a queued run that never starts. Staleness is computed from server receipt time and is separate from persisted run state. A stale run is not declared dead or failed. Duplicate retries do not refresh its last-seen time.

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

Phase 2 retains events, changes, and idempotency receipts. v1 W03b adds explicit
export and conservative retention under [V1_WORKFLOWS.md](V1_WORKFLOWS.md). Default
retention remains unlimited; no task hard-delete or automatic pruning is added.
Identity/digest/receipt ledgers and current evidence remain protected. A confirmed
prune renews stream generation, with snapshot recovery and preserved sessions;
restore continues to invalidate sessions. Storage growth is visible and measured.

## Durable browser updates

A data snapshot returns records and `snapshotCursor` from the same read transaction. The browser opens SSE after that cursor. The server polls committed changes in batches of 100, initially every 500 ms, and releases each query immediately. This avoids correctness dependence on an in-memory event emitter or framework hot reload.

SSE messages contain changed entity IDs, not private log bodies. The browser invalidates affected queries and reads current state. One connection serves each browser tab. The server sends a keepalive comment every 15 seconds and disconnects slow clients rather than building an unbounded queue. Limits begin at 20 connections and 1 MiB queued bytes per connection; P05 measures and adjusts them.

The stream uses each change cursor as its SSE ID. Reconnects replay committed changes after `Last-Event-ID`. A database restore or an invalid/out-of-range cursor yields `reset`, causing a fresh snapshot. Snapshots include a database `generation` UUID. Every authenticated HTTP response also carries the current UUID in `AgentFlow-Generation`. Stored acknowledgement bodies retain historical metadata; clients compare the response header before using them. Restore generates a new UUID so a reused numeric cursor cannot hide lost history. [SSE behavior](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).

## Local authentication and privacy

The launcher explicitly binds to `127.0.0.1`. Host headers must match `localhost:<port>` or `127.0.0.1:<port>`. It does not trust forwarded headers. Network exposure and LAN mode are unsupported.

First run atomically publishes separate random 256-bit pairing and reporter tokens in one versioned, owner-only `credentials.json` file outside SQLite. The operator copies the pairing token from the local setup command into the browser pairing form. `POST /api/v1/session` accepts only the pairing token and exchanges it for a random, hashed-at-rest session with a 12-hour expiry. Cookies use HttpOnly, SameSite=Strict, and Path=/; local HTTP cannot require Secure. Tokens never appear in URLs or browser storage. The stopped-service credential-rotation command stages a complete token set, commits all session revocation with synchronous FULL, then atomically publishes the token file and fsyncs its directory. Before revocation, an interruption retains old credentials/sessions. After revocation it retains no old sessions, whether old or new credentials are published. Unpublished protected staging files are discarded under the instance lock on restart.

All project data, server-rendered private pages, and SSE require authentication. CLI requests use the reporter token with `Authorization: Bearer`. Pairing tokens are invalid as bearer credentials. Reporter tokens cannot create sessions or call human-only commands. Stable principals are `operator` and `reporter`, so receipt lookup survives session renewal and token rotation after authentication. Cookie-authenticated mutations require an exact allowed Origin and JSON content type. All supplied Origin headers must match the allowed origin set, including bearer requests. Origin-less mutations require bearer authentication. Cookie-authenticated reads, RSC/prefetch, and page navigation accept same-origin or direct-navigation Fetch Metadata, and reject same-site and cross-site requests. Missing Fetch Metadata is permitted for authenticated direct clients, with any supplied Origin still checked. Health checks are public. Browser pairing also requires an allowed Origin. No permissive CORS headers are sent.

Request bodies are limited to 64 KiB. Progress text is limited to 4,000 characters. Titles are limited to 200, descriptions to 20,000, and acceptance criteria to 8,000. Invalid or oversized data is rejected before storage. Error responses omit stack traces, secrets, and raw filesystem details.

Hook text is untrusted text, never HTML. Repository paths and evidence paths are metadata only. The server does not execute or open them. URL fields allow only `https:` or `http:` links and never trigger server-side fetching. The harness must omit secrets and full prompts before reporting. Redaction patterns alone cannot guarantee secrecy.

This protects against unintended network access and hostile browser origins. It does not protect data from another program running with the same operating-system user privileges.


## P02 persistence implementation

P02 is an implementation candidate under review. Its [receipt](implementation/P02.md)
records source, commands, proof and pending integration. `Store.command` owns
immediate transactions and exact receipts; `Store.snapshot` owns short bounded
read transactions. Driver operations, cursor representation, SQL and transaction
mechanics stay in database modules. HTTP carries typed commands/queries from the
strict endpoint registry. Plain task decisions own lifecycle and work revisions.

Migration 0001 supplies real prerequisite agents/runs with foreign keys,
same-project task agreement, an active-task partial unique index, positive
versions, nonnegative lastSequence and nullable workRevision only for taskless
planning. Latest implementation evidence follows server insertion order,
including registrations sharing the same millisecond. Public registration/events
remain P04 work. W01 adds active-workflow archive rejection once workflow records
exist; P02 already rejects queued/running taskless planning runs on archive.

Comments and completion/reopen facts are append-only through production commands.
Each fact and the affected task receive durable changes in the same transaction.
Comments do not change task version or workRevision. Completion changes version
through the task transition; reopen increments both and retains acceptance history.
Parent checks and optimistic versions are transactional. Exact retries resolve
before current state checks, but credential-role authorization precedes replay.

Snapshot lists, board totals, histories, metrics, generation and feed maximum
share one read transaction. A captured server time supplies all freshness/day
calculations. Settings storage size is explicitly observational. The timezone
feasibility gate selected the approved exact-pinned Temporal fallback rather than
claiming that finite Intl probes establish all historical transitions. Six literal
boundary/membership cases passed before metric queries. The receipt links primary
library/Temporal documentation and qualifies host ICU availability.

A stopped-service restore validates any nonempty known checksum-valid migration
prefix and upgrades its private candidate before replacement. Historical P01
markers at staged/archived/replaced phases also upgrade before continuing. Migration
backup/drain, integrity, checkpoint/fsync, generation renewal and session revocation
remain owned operations. Invalid/newer/tampered schemas fail closed. No foundation
migration checksum was changed.


### Mandatory P04 registration-order prerequisite

Astra approved implicit rowid ordering only for bounded P02, which has no public
run registration/deletion, VACUUM or runs-table rebuild. Implicit rowid is not a
full-v1 durability contract. Before the first P04 public registration, add an
explicit immutable registration-order field with a uniqueness constraint in a
reviewed additive migration. Preserve migration 0001's checksum and backfill in
existing rowid order before any operation can change it. Allocate later values
transactionally with registration, using a durable monotonic allocator that does
not reuse order after pruning; exact retries retain the stored value.

Move both latest-run detail and latest-implementation acceptance queries to that
field. Prove tied timestamps and reversed UUID ordering, later failure superseding
success, current-revision acceptance, restart, backup/restore, VACUUM and a
representative table rebuild. P04's independent Astra plan approval must include
this prerequisite. If registration, deletion, VACUUM or rebuild moves into P02/P03,
the durable field must precede that expanded scope. PLAN retains this unchecked
acceptance item; the P02 receipt records the adjudication provenance.

### P04 Stage 1 migration candidate

Migration 0002 adds `runs.registration_order`, backfilled densely in prior rowid
order. Existing run facts remain unchanged. No registration identity, historical
request, event, or receipt is fabricated. Both latest queries use this explicit
order. It stays internal and is excluded from task-detail run serialization.

SQLite's additive column is physically nullable. Its CHECK rejects noninteger,
nonpositive, and unsafe values when present; reviewed insert/immutability triggers
require a value, forbid replacing an existing run identity, and reject order
changes. A unique index protects order identity. Drizzle declares effective
requiredness; real SQL guard and schema-parity tests cover the additive limitation.

The singleton `run_order_allocator` starts at the backfill maximum, or zero on a
fresh database. Internal code reads its next value within an immediate write
transaction. A run insert must exceed the retained high-water; its AFTER INSERT
trigger advances the allocator in the same transaction. Failed transactions
restore both. The database forbids allocator insertion, deletion, identity change,
reset, decrease, noninteger values and overflow. Deleting a highest run cannot
permit reuse. This allocator is not derived again from surviving run rows.

Non-reuse applies within retained database history. An older backup restores its
high-water and exact retained orders under a renewed generation, revoking browser
sessions. Values assigned only in discarded later history may recur. Numeric order
is not a public identity across generations. Public registration and observation
receipt restoration remain Stage 2 verification because those capabilities do not
yet exist in this candidate.

Migration validation conservatively tokenizes quotes, identifiers and comments,
recognizes the reviewed trigger header/body delimiters and CASE END expressions,
and rejects transaction or connection controls, including bare top-level END.
Unsupported or ambiguous lexical forms fail closed. SQLite remains the complete
SQL grammar authority inside the runner-owned immediate transaction. Existing
pre-migration backup, checksum, integrity and stopped-service restore behavior
remain required. This bounded recognizer is not a general SQL parser.
