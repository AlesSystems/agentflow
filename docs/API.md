# Local API contract

Status: planned v1 contract. These endpoints do not exist yet. P02 publishes generated OpenAPI from shared Zod schemas; P04 and P05 extend it with the reporting contracts below. W01–W03c add the
[Phase 3 contracts](V1_WORKFLOWS.md), including workflow reports, dependency/review
commands, opt-in GitHub observation, export/retention, and usage.

## Conventions

The base URL is `http://127.0.0.1:3000/api/v1`. UUIDs identify records. Fields use camelCase. Timestamps are RFC 3339 UTC strings. Unknown request fields and unknown event schema versions are rejected.

Browser sessions and CLI bearer credentials use the authentication rules in [BACKEND.md](BACKEND.md). Every endpoint except health and session creation requires authentication. Complete, reopen, and close-run commands require a browser session. The reporter token cannot pair a browser session or call human-only commands. Pairing and reporter credentials are distinct.

JSON mutations require `Content-Type: application/json`. Resource mutations require an `Idempotency-Key` UUID, except session creation/deletion and run/workflow event ingestion. Those events use their own `eventId`. The receipt key is scoped to stable principal, HTTP method, path, and key. Session renewal does not change the operator principal. Exact retries return the original status and body, including after a later version change. A different body returns `409 idempotency_conflict`. Failed requests do not consume a key.

PATCH bodies and complete, reopen, and close-run action bodies require `expectedVersion`. The server checks it in the mutation transaction. A mismatch returns `409 version_conflict` and `currentVersion`; the caller reads the resource before retrying an intentional change with a new key. Empty PATCH objects and unsupported fields return `422`.

Successful JSON responses use `data`, `snapshotCursor`, and `generation`; session creation and deletion are exceptions. Session creation returns `200` with a Set-Cookie header and no private data, and deletion returns `204`. Every authenticated response carries the current `AgentFlow-Generation` header. Exact-retry bodies retain the original receipt generation and cursor as historical metadata. If the header differs from the client snapshot or receipt generation, the client obtains a fresh snapshot before using the result. Mutation replies never advance the subscription cursor. Even within one generation, an old receipt must not overwrite a newer cached entity version; commands trigger an authoritative refetch. List `data` contains `items` and `nextCursor`. Cursors are opaque, bound to filters and sort order, with a default page size of 50 and maximum of 100. Mutable lists use stable creation-time/ID order so edits do not move the pagination boundary. The client refetches after change notifications.

All private responses use `Cache-Control: no-store`. Health returns only readiness and API version. Command responses are acknowledged only after commit. No route starts a process. Foundation/reporting routes make no outbound requests;
W03a alone adds explicit, opt-in, allowlisted GitHub PR metadata refresh under
[V1_WORKFLOWS.md](V1_WORKFLOWS.md).

## Foundation routes

Paths below are relative to `/api/v1`.

| Method and path | Behavior |
| --- | --- |
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
| `GET /activity` | Paginated user-facing history, optional project/task/agent filters |
| `GET /changes/stream` | Authenticated SSE invalidations with replay |

Run creation requires `id`, `projectId`, `agentId`, `purpose`, and, except for planning, `taskId`. `model` is optional display metadata. A task-linked request also includes `expectedTaskVersion`. The server captures the current work revision, incrementing it first for implementation attempts. Reusing an existing run ID with a different request returns `409 run_conflict`. An identical registration with a different idempotency key returns the stored registration result with `200`, without incrementing any revision. Authentication and credential-role checks still apply to all retries.

Register the project, task, agent, and run before reporting events. Missing references return `404 resource_not_found`; no partial records are created. Lifecycle conflicts and an existing active run return `409`. A second agent can work in parallel on a separate task.

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

The body run ID must match the route. Identity and purpose come from the registered run. A client cannot change the agent or task through an event.

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

An exact retry returns this same body with `200`. A sequence gap returns the expected next sequence and makes no changes. A delayed event cannot regress the task. An unknown schema version returns `422 unsupported_schema_version`.

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
| `403` | Invalid Host/Origin or action requiring a browser session |
| `404` | Missing project, task, agent, or run |
| `409` | Version, idempotency, sequence, lifecycle, or archive conflict |
| `413` | Request exceeds 64 KiB |
| `415` | Mutation is not JSON |
| `422` | Schema, field, or reference-shape validation failure |
| `429` | Local request/connection limit; includes `Retry-After` |
| `503` | Database busy or service not ready; includes `Retry-After` |

Successful idempotency receipts and run-event deduplication survive restarts. Validation failures do not leave receipts. Rate limits start at 100 mutation requests/second with a burst of 200 per installation and are a P07 tuning target. Reads have bounded result size.

## SSE contract

The initial connection uses `GET /changes/stream?after=42&generation=<snapshot-generation>`. Reconnect uses `Last-Event-ID` in preference to `after` and the same generation. Browser EventSource uses the HttpOnly session cookie. Credentials never appear in the query string.

```text
id: 43
event: change
data: {"entityType":"task","entityId":"50000000-0000-4000-8000-000000000001","kind":"updated"}

```

A blank line terminates each SSE message. Messages use `Content-Type: text/event-stream`, `Cache-Control: no-store`, and no response compression or buffering. Connection abort clears polling resources.

If the generation differs or the cursor is out of range, send `event: reset` with a JSON reason and close. The browser closes its old EventSource, obtains a new snapshot, and reconnects. A malformed cursor receives `400` before streaming. Phase 2 retains all history. W03b adds generation reset on explicit retention;
old cursors require a fresh snapshot and protected event/receipt ledgers remain.

Snapshots and changes must not leave a gap when writes occur between the initial query and subscription. The browser deduplicates by cursor and ignores already applied changes within the same generation. It refetches affected queries instead of trying to replay task business rules.

## CLI integration contract

The planned CLI provides `agentflow project create`, `task create`, `agent register`, `run register`, `report`, and `flush`. It uses the same public API and schemas. Registration commands accept JSON files and return IDs as JSON. The report command accepts a run ID, event type, and payload file. These commands are not installed by this PR.

`report` allocates event ID, timestamp, and sequence atomically under a per-run outbox lock, writes an immutable record to disk, then attempts delivery. Only one producer owns each run's sequence. Calling `report` for a new logical event allocates a new ID; uncertain delivery retries use `flush`, never a second report call.

The outbox is durable with a 10 MiB limit per run and 100 MiB overall. It never silently drops unacknowledged events. Disk-full or limit exhaustion returns a clear failure. `flush` sends each run in sequence and deletes a record only after a committed acknowledgement. Retryable network, `429`, and `503` responses use exponential backoff with jitter, capped at 30 seconds. A sequence gap triggers resend from the missing outbox entry. A conflict, terminal run, or missing outbox entry stops that run's flush for operator action.

A single invocation retries for at most five seconds, then exits. Exit codes are `0` delivered, `2` durably queued after retryable delivery failure, `1` invalid input or unable to preserve the report, and `3` delivery blocked pending operator repair. Code `3` covers credential rejection, non-retryable server rejection such as conflicting or terminal reports, and an unrecoverable sequence gap. Preserve unacknowledged outbox records and report the affected run, error code, and actionable repair without secrets. Multi-run `flush` uses precedence `1`, then `3`, then `2`, then `0`; blocked runs do not prevent independent runs from flushing. The harness decides whether reporting failure affects its own job. A later hook or explicit `flush` retries queued data; no background daemon is implied.

A replay after database restoration requires re-registering missing entities with their original IDs where supported. A lost task/agent registration receipt may require rebuilding references before reporting. The first release recovery guide must make this limit explicit; a restore cannot guarantee preservation of observations acknowledged after the backup.

The harness must explicitly emit events. AgentFlow does not scrape Codex or Claude Code private state. Provider-specific adapters can follow after the generic integration has end-to-end evidence.
