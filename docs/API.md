# Local API contract

Status: P01–P03 are integrated. P04 observation routes are implemented and verified;
final documentation/evidence review and integration remain the coordinator gate.
[Generated OpenAPI](openapi.json) describes implemented operations only. P05
Activity/SSE routes remain planned. W01–W03c add the
[Phase 3 contracts](V1_WORKFLOWS.md).

## Conventions

The base URL is `http://127.0.0.1:3000/api/v1`. UUIDs identify records. New client UUID identities and input references normalize to lowercase; original parsed JSON casing remains part of request digest identity. Stored legacy identities and historical acknowledgements retain their original bytes. Case-insensitive lookups preserve those actual stored IDs for references and projection writes. An existing casing collision rejects with `409 identity_ambiguous` rather than merging records. Fields use camelCase. Timestamps are RFC 3339 UTC strings. Unknown request fields and unknown event schema versions are rejected.

Browser sessions and CLI bearer credentials use the authentication rules in [BACKEND.md](BACKEND.md). Every endpoint except health and session creation requires authentication. Complete, reopen, and close-run commands require a browser session. The reporter token cannot pair a browser session or call human-only commands. Pairing and reporter credentials are distinct.

GET/HEAD requests must be bodyless or declare Content-Length 0. Other body
framing returns 400; a declared length over 64 KiB returns 413. Mutation bodies
are limited while streaming, with a five-second completion timeout.

JSON mutations require `Content-Type: application/json`. Resource mutations require an `Idempotency-Key` UUID, except session creation/deletion and run/workflow event ingestion. Those events use their own `eventId`. The receipt key is scoped to stable principal, HTTP method, path, and key. Session renewal does not change the operator principal. Exact retries return the original status and body, including after a later version change. A different body returns `409 idempotency_conflict`. Failed requests do not consume a key.

PATCH bodies and complete, reopen, and close-run action bodies require `expectedVersion`. The server checks it in the mutation transaction. A mismatch returns `409 version_conflict` and `currentVersion`; the caller reads the resource before retrying an intentional change with a new key. Empty PATCH objects and unsupported fields return `422`.

Successful JSON responses use `data`, `snapshotCursor`, and `generation`; session creation, deletion, and the P01 foundation readiness read are exceptions. Session creation returns `200` with a Set-Cookie header and no private data, and deletion returns `204`. Every authenticated response carries the current `AgentFlow-Generation` header. Exact-retry bodies retain the original receipt generation and cursor as historical metadata. If the header differs from the client snapshot or receipt generation, the client obtains a fresh snapshot before using the result. Mutation replies never advance the subscription cursor. Even within one generation, an old receipt must not overwrite a newer cached entity version; commands trigger an authoritative refetch. List `data` contains `items` and `nextCursor`. Cursors are opaque, bound to filters and sort order, with a default page size of 50 and maximum of 100. Mutable lists use stable creation-time/ID order so edits do not move the pagination boundary. The client refetches after change notifications.

All private responses use `Cache-Control: no-store`. Health returns only readiness and API version. Command responses are acknowledged only after commit. No route starts a process. Foundation/reporting routes make no outbound requests;
W03a alone adds explicit, opt-in, allowlisted GitHub PR metadata refresh under
[V1_WORKFLOWS.md](V1_WORKFLOWS.md).

## Foundation routes

Paths below are relative to `/api/v1`.

| Method and path | Behavior |
| --- | --- |
| `GET /foundation` | P01 authenticated readiness `{ "ready": true, "generation": "UUID", "schemaVersion": 2 }`; no task snapshot/cursor |
| `GET /health` | `200` ready or `503` not ready; no private metadata |
| `POST /session` | Exchange the pairing token for a browser session; body `{ "token": "..." }` |
| `DELETE /session` | Revoke the current session, body `{}`; `204` |
| `GET /overview?timezone=Europe/London` | Snapshot metrics and attention items; validate IANA timezone |
| `GET /settings` | Data location, storage size, selected timezone; no credentials |
| `PATCH /settings` | Browser-only timezone update with `expectedVersion` |
| `GET /projects` | List projects; optional `archived` filter |
| `POST /projects` | Create from name and optional repository path; `201` |
| `GET /projects/{id}` | Read one project |
| `PATCH /projects/{id}` | Rename, update path metadata, or archive with `expectedVersion` |
| `GET /projects/{id}/board` | Four task columns, per-column totals and cursors, one snapshot cursor |
| `GET /tasks` | Filter by project, status, priority, tag, assigned agent, and title query |
| `POST /tasks` | Create a task in `backlog`; `201` |
| `GET /tasks/{id}` | Task, current completion, latest run, and history links |
| `PATCH /tasks/{id}` | Edit allowed task fields or move among non-completed statuses |
| `POST /tasks/{id}/complete` | Human acceptance note and optional evidence URL; `201` completion record |
| `POST /tasks/{id}/reopen` | Human reason and `expectedVersion`; `200` updated task |
| `GET /tasks/{id}/comments` | Paginated comments |
| `POST /tasks/{id}/comments` | Append text, actor from credential; `201` |

Board filters match `/tasks`. A board column cursor is used with `/tasks?projectId=...&status=...` and the same filters for later pages. Archive rejects a project with active task or workflow runs. Archived projects retain history but reject new tasks, runs, and task mutations until unarchived. No task/project hard deletion is supported; W03b has a separate protected-history pruning contract.

A task create body contains `projectId`, `title`, and optional `description`, `acceptanceCriteria`, `priority`, `tags`, `assignedAgentId`, `targetRole`, `parentTaskId`, `branch`, `pullRequestUrl`, and `blockedReason`. Defaults are empty text/list values, `normal` priority, null references, `version=1`, and `workRevision=1`. Status is not client-selected on creation.

PATCH allows the same editable task fields except project ID, plus `status` and `expectedVersion`. Parent changes obey same-project and cycle checks. Run history, completion, timestamps, versions, and work revisions are never directly editable. Lists are bounded to 20 tags of at most 40 characters. Comments and acceptance notes are limited to 4,000 characters. Reference URLs and path metadata are limited to 2,000 characters.

Example task request, sent with a fresh idempotency key.

```json
{
  "projectId": "10000000-0000-4000-8000-000000000001",
  "title": "Add authentication endpoint",
  "description": "Implement the local sign-in handler.",
  "acceptanceCriteria": "Reject expired credentials and cover the failure path.",
  "priority": "high",
  "targetRole": "implementation"
}
```

Example human completion request.

```json
{
  "expectedVersion": 7,
  "evidenceNote": "Reviewed the diff and inspected the passing focused test report.",
  "evidenceUrl": "https://github.com/example/project/pull/42"
}
```

The completion command verifies the task-state conditions in [BACKEND.md](BACKEND.md). It records a human attestation; it does not fetch the URL or independently verify the report.

## Agent and run routes

| Method and path | Behavior |
| --- | --- |
| `GET /agents` | Agent registry and derived reporting freshness |
| `POST /agents` | Register display name, source, and default role; `201` |
| `GET /agents/{id}` | Identity, active runs, and paginated history links |
| `PATCH /agents/{id}` | Change display metadata with `expectedVersion` |
| `POST /runs` | Register an attempt with client-generated run ID; `201` |
| `GET /runs` | Filter by project, agent, task, state, or stale flag |
| `GET /runs/{id}` | Run state, `lastSequence`, task reference, version, freshness |
| `POST /runs/{id}/events` | Accept one event atomically; `201` new, `200` exact duplicate |
| `GET /runs/{id}/events` | Paginate by sequence ascending |
| `POST /runs/{id}/close` | Browser-only close of stale active tracking; reason and `expectedVersion` |
| `GET /activity` (P05) | Planned paginated user-facing history, optional project/task/agent filters |
| `GET /changes/stream` (P05 transport slice) | Browser-session SSE invalidations with replay; finite HEAD |

Run creation requires `id`, `projectId`, `agentId`, `purpose`, and, except for planning, `taskId`. `model` is optional display metadata. A task-linked request also includes `expectedTaskVersion`. The server captures the current work revision, incrementing it first for implementation attempts. Reusing an existing run ID with a different request returns `409 run_conflict`. An identical new P04 registration with a different idempotency key returns the stored original registration result with `200`, without incrementing any revision. Legacy runs from migration 0001 have no original registration identity. Every registration POST using an existing legacy ID returns `409 run_conflict`, even if the body looks identical; it creates no receipt or identity and changes no order, version, revision, or projection. Legacy reads, permitted events and stale closure continue normally. Authentication and credential-role checks still apply to all retries.

Register the project, task, agent, and run before reporting events. Missing references return `404 resource_not_found`; no partial records are created. Lifecycle conflicts and an existing active run return `409`. A second agent can work in parallel on a separate task.


Agent creation accepts an optional UUID `id`, otherwise the server assigns one. `displayName` and `source` are nonempty and bounded to 200 characters; `defaultRole` uses orchestrator, implementation, reviewer, or verifier. PATCH changes only these metadata fields with `expectedVersion`. Changing an agent's default role does not alter an existing run. `model` is optional nonempty metadata bounded to 200 characters. Project/task creation schemas remain unchanged and cannot adopt supplied IDs.

Agents and runs use bounded snapshots with `snapshotCursor` and `generation`. Agent reporting is derived from fresh running observations, never process liveness. Agent detail supplies separate queued/running list links and a history link. Lists default to 50, maximum 100; runs sort by internal immutable registration order descending and accept `projectId`, `agentId`, `taskId`, `state`, and `stale=true|false`. Raw events sort by sequence ascending and retain heartbeats. Cursors bind generation, filters, limit and order. Totals and derived freshness use one captured server time in the same read transaction. Stale-filter pages describe observations at their individual capture times, not a frozen historical multi-page snapshot. Internal order is never a public identity or response field. Task detail's `latestRun` retains its P03 shape.

Run responses add `freshness` with `stale` and `reporting` (`no_report_received`, `fresh`, `stale`, or `terminal`). Queued sequence zero has no report received. An active run is stale only when server receipt age exceeds 60,000 ms; exactly 60,000 is fresh. Producer occurrence time cannot refresh an observation. A terminal observation is never labeled stale or reporting.

Browser closure requires `reason`, `expectedVersion`, and an idempotency key. Only stale queued/running records can close. It records an immutable operator closure fact, changes tracking to interrupted, and increments run version. It does not invent a producer event/sequence, move the task column, change work revision, or send a process signal. **The external process may still run.** P05 supplies the confirmation UI. Exact authenticated closure receipt retries return the original body before current lifecycle checks.

## Event envelope

Each run has one ordered producer. `sequence` starts at 1 and increments for every event, including heartbeats. `occurredAt` is producer metadata. The server records `receivedAt` and uses sequence for lifecycle order.

```json
{
  "schemaVersion": 1,
  "eventId": "30000000-0000-4000-8000-000000000001",
  "runId": "20000000-0000-4000-8000-000000000001",
  "sequence": 1,
  "type": "run.started",
  "occurredAt": "2026-10-09T10:00:00Z",
  "payload": {}
}
```

The strict schemaVersion 1 envelope rejects unknown fields. Sequence is a positive safe integer. The offset-bearing occurrence timestamp is normalized to UTC for storage. Authentication, transport guards and typed validation precede identity lookup. The body run ID must match the route. Identity and purpose come from the registered run. A client cannot change the agent or task through an event.

| Type | Payload | Valid input state and effect |
| --- | --- | --- |
| `run.started` | Empty object | `queued` to `running`; implementation task moves to In progress |
| `run.heartbeat` | Empty object | `running`; refresh receipt time only |
| `run.progress` | Required `message`, optional integer `percent` from 0 to 100 | `running`; append bounded progress |
| `run.succeeded` | Required `summary`, optional `evidenceUrl` | `running` to `succeeded`; implementation task moves to Review |
| `run.failed` | Required `message`, optional `code` | `running` to `failed`; task column remains unchanged |
| `run.cancelled` | Required `reason` | `queued` or `running` to `cancelled`; reports external cancellation |

Message, summary, and reason limits are 4,000 characters. Code is limited to 100. Percent is advisory and may decrease during rework. No event claims human task completion. Heartbeats are stored but collapsed from the normal Activity view; the raw run history retains them.

Example new-event acknowledgement.

```json
{
  "data": {
    "eventId": "30000000-0000-4000-8000-000000000001",
    "runId": "20000000-0000-4000-8000-000000000001",
    "acceptedSequence": 1,
    "receivedAt": "2026-10-09T10:00:01Z"
  },
  "snapshotCursor": "42",
  "generation": "40000000-0000-4000-8000-000000000001"
}
```

An exact valid retry returns this same body with `200`, including after termination or interruption, without refreshing receive time, run version, sequence, order, cursor or projection. Event IDs are globally unique across runs; a changed canonical body or different run returns `409 idempotency_conflict`. Original parsed JSON supplies the digest before normalization. JSON key order and formatting whitespace are irrelevant, while omitted versus explicit fields and string whitespace remain distinct. A sequence gap returns `409 sequence_gap` with `details.expectedSequence` and makes no changes. A lower/reused sequence under a new event ID returns `409 sequence_conflict`. Sequence checks precede lifecycle guards, so a terminal report at the expected sequence returns `409 run_terminal` while a gap remains a sequence error. A delayed event cannot regress the task. An unknown schema version returns `422 unsupported_schema_version`.

## Error contract

```json
{
  "error": {
    "code": "sequence_gap",
    "message": "Send the missing event before retrying this event.",
    "details": { "expectedSequence": 2 }
  }
}
```

| Status | Use |
| --- | --- |
| `400` | Malformed JSON, invalid cursor, or malformed query |
| `401` | Missing, invalid, or expired credential |
| `408` | Request body did not finish within five seconds |
| `403` | Invalid Host/Origin or action requiring a browser session |
| `404` | Missing project, task, agent, or run |
| `409` | Version, idempotency, sequence, lifecycle, or archive conflict |
| `413` | Request exceeds 64 KiB |
| `415` | Mutation is not JSON |
| `422` | Schema, field, or reference-shape validation failure |
| `429` | Local request/connection limit; includes `Retry-After` |
| `503` | Database busy or service not ready; includes `Retry-After` |

Successful idempotency receipts and run-event deduplication survive restarts. An older stopped restore retains only the backup's identities, event acknowledgements, closure facts and allocator high-water under a renewed generation and revoked browser sessions. Retained retries return historical bodies with the current generation header. Discarded post-backup acknowledgements do not survive. A missing run can be registered again only if its references and current task version permit it; an event for a missing run returns 404. Missing project/task references require explicit recreation/remapping because their creation schemas do not accept original IDs. Validation failures do not leave receipts. Rate limits start at 100 mutation requests/second with a burst of 200 per installation and are a P07 tuning target. Reads have bounded result size.

## SSE contract

The initial connection uses `GET /changes/stream?after=42&generation=<snapshot-generation>`. Reconnect uses `Last-Event-ID` in preference to `after` and the same generation. Browser EventSource uses the HttpOnly session cookie. Credentials never appear in the query string.

```text
id: 43
event: change
data: {"entityType":"task","entityId":"50000000-0000-4000-8000-000000000001","kind":"updated"}

```

A blank line terminates each SSE message. Messages use `Content-Type: text/event-stream`, `Cache-Control: no-store`, and no response compression or buffering. Connection abort clears polling resources.

If the generation differs or the cursor is out of range, send `event: reset` with a JSON reason and close. The browser closes its old EventSource, obtains a new snapshot, and reconnects. Cursors are canonical decimal strings from `0` through `9223372036854775807`. Both supplied `after` and `Last-Event-ID` are validated, even when the latter overrides the former. Missing, duplicate, unknown, noncanonical or unsupported-range inputs receive `400` before streaming. A supported cursor ahead of the committed maximum resets and closes. Stream authority requires a browser session; reporter and pairing bearers cannot subscribe. HEAD is finite and bodyless. The installation admits 20 streams; excess requests receive finite `429` with `Retry-After: 1`. Polling uses 500ms short reads; keepalives use 15s. The 1MiB encoded queue/native-buffer ceiling and independent five-second stalled-drain deadline disconnect slow readers for durable replay. Independent 500ms session revalidation continues while blocked. Revocation discards unsent data; previously socket-buffered bytes cannot be recalled. Phase 2 retains all history. W03b adds generation reset on explicit retention;
old cursors require a fresh snapshot and protected event/receipt ledgers remain.

Snapshots and changes must not leave a gap when writes occur between the initial query and subscription. The browser deduplicates by cursor and ignores already applied changes within the same generation. It refetches affected queries instead of trying to replay task business rules.

## CLI integration contract

The planned CLI provides `agentflow project create`, `task create`, `agent register`, `run register`, `report`, and `flush`. It uses the same public API and schemas. Registration commands accept JSON files and return IDs as JSON. The report command accepts a run ID, event type, and payload file. These commands are not installed by this PR.

`report` allocates event ID, timestamp, and sequence atomically under a per-run outbox lock, writes an immutable record to disk, then attempts delivery. Only one producer owns each run's sequence. Calling `report` for a new logical event allocates a new ID; uncertain delivery retries use `flush`, never a second report call.

The outbox is durable with a 10 MiB limit per run and 100 MiB overall. It never silently drops unacknowledged events. Disk-full or limit exhaustion returns a clear failure. `flush` sends each run in sequence and deletes a record only after a committed acknowledgement. Retryable network, `429`, and `503` responses use exponential backoff with jitter, capped at 30 seconds. A sequence gap triggers resend from the missing outbox entry. A conflict, terminal run, or missing outbox entry stops that run's flush for operator action.

A single invocation retries for at most five seconds, then exits. Exit codes are `0` delivered, `2` durably queued after retryable delivery failure, `1` invalid input or unable to preserve the report, and `3` delivery blocked pending operator repair. Code `3` covers credential rejection, non-retryable server rejection such as conflicting or terminal reports, and an unrecoverable sequence gap. Preserve unacknowledged outbox records and report the affected run, error code, and actionable repair without secrets. Multi-run `flush` uses precedence `1`, then `3`, then `2`, then `0`; blocked runs do not prevent independent runs from flushing. The harness decides whether reporting failure affects its own job. A later hook or explicit `flush` retries queued data; no background daemon is implied.

A replay after database restoration requires re-registering missing entities with their original IDs where supported. A lost task/agent registration receipt may require rebuilding references before reporting. The first release recovery guide must make this limit explicit; a restore cannot guarantee preservation of observations acknowledged after the backup.

The harness must explicitly emit events. AgentFlow does not scrape Codex or Claude Code private state. Provider-specific adapters can follow after the generic integration has end-to-end evidence.


## P02 serialized contracts

Shared strict Zod schemas and the endpoint registry generate `openapi.json`.
`npm run openapi:check` validates published examples and detects stale output.
The native guard uses the same registry for early authentication and command
roles. Unsupported fields, duplicate query parameters and mutation query strings
reject without a receipt. UUID idempotency keys and concrete paths are canonicalized
for receipt scope. Original parsed JSON is retained before trims/defaults.
Object key order and JSON formatting whitespace are irrelevant; whitespace inside
string values and omitted versus explicit defaults remain different requests.

Project queries accept `archived=true|false`, `limit` and `cursor`. Task queries
accept `projectId`, `status`, `priority`, `tag`, `assignedAgentId`, `q` for a title
substring, `limit` and `cursor`. Board queries accept the same filters except
project/status/cursor, which come from the route and column. All pages default
to 50 and cap at 100. Stable ordering is descending creation time then ID.
List data is `{ items, total, nextCursor }`. Board data is
`{ columns: [{ status, items, total, nextCursor }] }`, with the four fixed statuses.
Each board cursor works with the corresponding `/tasks` status and identical
filters and limit. Cursors bind generation, entity kind, filters, limit and order.

`TaskDetailV1` data is `{ task, currentCompletion, latestRun, history }`.
`currentCompletion` is null until current work is completed. `latestRun` is
nullable persisted observation metadata. `history` contains `commentsUrl`,
`completions` and `reopens`. Each requested history container is
`{ items, nextCursor, nextUrl }`; an unrequested container is null.
GET task query `TaskDetailQueryV1` accepts `history=both|completion|reopen`,
`historyLimit`, `completionCursor` and `reopenCursor`. Initial reads default to
both histories and 50 records each. Each nextUrl is a working GET task URL with
its independent cursor, history selector and limit. A supplied cursor for an
unrequested kind rejects. Empty/exhausted requested pages have an empty items
array and null continuation values. P04 supplies run lists and raw event-history
endpoints; task detail keeps its P03 history shape.

Comments append immutably to tasks in unarchived projects, including completed
tasks. They change neither task version nor work revision nor current acceptance.
Archived projects reject comment append. Task edits remain rejected on completed
work until reopen. Description limit is 20,000; acceptance-criteria limit is
8,000. Name/title/branch/title-query limits are 200; blocker/note/comment/reason
limits are 4,000. Existing tag, URL, path and body limits remain independent.
Work revision compares changed values rather than field presence.

Settings data is `{ timezone, version, dataLocation, storageBytes,
storageMeasurement: "observational" }`. Database values belong to the snapshot;
filesystem database/WAL size sampling is observational. UTC is initial until P03
browser initialization. Validated named IANA aliases, including UTC and Etc names,
are retained as supplied. Raw numeric-offset pseudo-zones reject.

Overview data contains `metrics`, `attention`, `timezone`, `capturedAt` and
`day: { start, end }`. Metric names are `activeProjects`, `reportingAgents`,
`completedToday`, `awaitingReview` and `failedRunsToday`. Attention is a bounded
`{ items, total, nextCursor }` page. Each item has `id`, `projectId`, nullable
`taskId`/`runId`, `title`, `createdAt` and grouped `reasons` from blocked/failed/stale.
Taskless planning runs appear once. Archived projects are excluded. Reporting
means a running record received within 60 seconds; it never claims process liveness.
Today is a half-open local-day interval with earliest valid midnight, repeated
midnight first occurrence and an empty skipped date. The exact-pinned Temporal
fallback and literal feasibility fixtures are recorded in [P02](implementation/P02.md).

All resource reads and writes return snapshot metadata. Completed command receipts
remain historical after newer versions or restore. Clients compare the current
response generation header and refetch authoritative state; an old receipt never
advances a future subscription cursor. P04 adds explicit observation routes;
Activity and browser live tracking remain P05; native SSE is implemented in the first transport slice.

### P05 tracking reads

Additive bounded reads preserve every original task/command/receipt shape.
`GET /tracking/projects/{id}/board` and `/tracking/tasks` accept the original
board/task filters and return tasks with nullable `latestAttempt`. Its stored
run, freshness, agent/source, project/task names and latest non-heartbeat message
are joined/batched at the snapshot boundary. No registered attempt means null.
`GET /tracking/agents` pages identities with fresh-running, queued-no-report and
stale-active counts. `/tracking/runs` accepts run filters; `/tracking/runs/{id}`
returns the same joined attempt summary. These labels describe received reports.

`GET /activity` accepts limit/cursor and optional projectId/agentId/taskId.
Stable descending receipt-time/identity pagination binds generation and filters,
resolving UUID aliases to actual stored foreign keys. The joined feed contains
stored producer reports except heartbeat noise, plus separately typed human
tracking closure facts with reason and no producer event/occurred time. Raw
`/runs/{id}/events` remains ascending sequence and retains every heartbeat.
All endpoints share registered read authentication, strict schemas and OpenAPI.
