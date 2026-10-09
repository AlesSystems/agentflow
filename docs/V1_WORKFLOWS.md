# v1 workflows and evidence

Status: design contract, pending implementation and validation. On 2026-10-09 the
operator requested all phases in order for one future implementation run. This
file proposes the bounded Phase 3 choices within that scope; it does not claim
these details were individually approved, implemented, or tested. The current
change is documentation only. [PLAN.md](../PLAN.md) and
[EXECUTION_POLICY.md](EXECUTION_POLICY.md) own activation, delivery, and release.

W01 follows the Phase 2 tracking foundation. W02 follows W01. Execute W03a,
W03b, and W03c after W02, then the full v1 W04 gate in PLAN.md. All packages are
required for v1, including optional connection features and their test evidence.
AgentFlow remains an observer: the external harness owns processes, scheduling,
credentials, and execution. No launch, stop, shell, scheduler, or automatic task
completion belongs in these packages.

## Shared additive contracts

Extend [API.md](API.md), [BACKEND.md](BACKEND.md), and generated OpenAPI with
shared Zod schemas. Keep `/api/v1`, UUIDs, camelCase, RFC 3339 UTC timestamps,
strict unknown-field rejection, the 64 KiB request limit, authentication, no-store
responses, generation headers, and committed acknowledgement envelopes.
Browser policy edits use `expectedVersion` and `Idempotency-Key`; reporters can
publish observations but cannot make human acceptance or connection decisions.
Changes, projections, receipts, and observations commit together. Exact retries
return stored receipts without advancing versions or refreshing report freshness.

Use additive migrations, foreign keys, unique IDs/sequences, and indexes for
project/history queries. Preserve historical revisions. Existing producers may
omit every new optional field. New event types use explicit shared schemas;
unsupported types or schema versions fail before writing. Existing task/run
lifecycle and active-run uniqueness remain in force unless changed below.

## W01. Reported workflow graph

A workflow describes reported work in one project. It is a read-only graph/list
view in the browser, with no drag editing or inferred nodes. A harness publishes
immutable plan revisions and separate observed workflow attempts.

| Record | Minimal contract |
| --- | --- |
| Workflow | `id`, `projectId`, bounded `name`, `version`, creation time |
| Plan revision | `id`, `workflowId`, increasing `revision`, immutable nodes/edges |
| Plan node | Stable node ID within workflow, label, optional same-project `taskId` |
| Plan edge | Source/target node IDs; ordering metadata within that revision |
| Workflow run | `id`, `workflowId`, `planRevisionId`, state, `version`, `lastSequence`, receipt time |
| Workflow report | Event ID, sequence, schema version, occurrence/receipt times, digest |
| Node observation | Workflow run/node, optional task-linked `runId`, reported state/skill |

Plan revision creation requires `expectedWorkflowVersion`. Reject duplicate node
IDs, missing edge endpoints, self edges, cycles, and cross-project task/run
references atomically. A revision contains at most 100 nodes and 200 edges; a
larger plan requires separate workflows. Store revisions relationally or as
validated immutable JSON; avoid a second graph storage engine.

A workflow run binds one immutable revision. Node observations reference only
nodes in that revision. A linked attempt must belong to the node's task and
project; existing run records remain authoritative for attempt lifecycle.
One node may link successive attempts through separate observations; do not
replace earlier links or fabricate a run from a node status. Plan edges describe
reported ordering; they do not establish W02 task dependencies implicitly.

Optional `reportedSkill` is `{ name, source?, version? }`: strings bounded to
200, 2000, and 200 characters respectively. Source is inert text, never fetched
or executed. Missing fields display “Unknown”; an agent role, node name, or
installed skill directory does not prove skill use. Render all hook text safely.

Proposed routes: `POST /workflows`, `GET /workflows?projectId=...`,
`GET /workflows/{id}`, `POST /workflows/{id}/revisions`,
`GET /workflows/{id}/revisions/{revisionId}`, `POST /workflow-runs`,
`GET /workflow-runs/{id}`, `POST /workflow-runs/{id}/events`, and browser-only
`POST /workflow-runs/{id}/close`. Close requires reason and `expectedVersion`,
applies only to stale active workflow records, and records terminal `interrupted`.
It never stops an external process; a surviving producer registers a new attempt.
Registration uses normal idempotency keys and immutable ID conflict handling.
Report envelopes mirror run events, with `workflowRunId`, sequence starting at 1,
and `eventId`. Types are `workflow.started`, `workflow.node.reported`, `workflow.heartbeat`,
`workflow.succeeded`, `workflow.failed`, and `workflow.cancelled`. A workflow run
starts queued; start moves it to running, and success/failure/cancellation are
terminal (queued cancellation is allowed). Node reports and heartbeats require
running state. Terminal runs reject new events but resolve exact retries first.
Only one queued/running workflow attempt is permitted per workflow. A new attempt
uses a new run ID. Terminal outcome is explicitly reported, never inferred from
node colors; it cannot complete linked tasks. Project archive rejects active
workflow attempts as well as active task attempts.
Node payload includes `nodeId`, optional `runId`, optional `reportedSkill`, and
reported state from `pending`, `running`, `succeeded`, `failed`, `cancelled`.
These are observations, not commands to change a linked task or attempt.

Use one producer and durable outbox sequence allocator per workflow run. Resolve
exact duplicate IDs before projection checks; changed ID bodies, reused sequences,
and gaps return existing conflict codes without writes. No buffering or clock
ordering. Workflow heartbeat refreshes only the workflow observation; it cannot
refresh a linked run. Silence over 60 seconds for a queued/running workflow is stale observation, not
process death. Terminal workflows retain last report time without an active-stale
warning; a missing node report remains unknown even when the workflow is terminal. Reuse the visible 15-second freshness refresh and SSE snapshot/reset rules.

Graph and equivalent list expose revision, reported time, freshness, task/attempt
links, and unknown skill metadata. Keyboard users can reach every node and link;
the list remains usable at 375 px and 200% zoom. Bound graph rendering to one
revision, paginate history, retain selection on refresh, and show disconnected
or uncertain states explicitly. React Flow is display only.

Planned files: `src/contracts/workflows.ts`, `src/domain/workflows.ts`,
`src/server/workflows/`, `src/db/` and `migrations/`, workflow API routes,
`src/components/workflows/`, CLI outbox extensions, and focused integration/e2e tests.
Pass with real HTTP publication of two revisions, immutable old-run linkage,
sequence/crash/lost-response retries, cross-project rejection, absent-skill display,
and graph/list keyboard/narrow-layout evidence. Restart and reconnect preserve it.

## W02. Dependencies, review decisions, and rework

Task dependencies form a same-project DAG. A browser-only command replaces a
task's direct prerequisite IDs atomically with `expectedVersion`; reject duplicates,
self references, missing/archived references, and any cycle. Limit to 20 direct
prerequisites per task. Parentage remains grouping and never implies dependency.
A browser policy edit is rejected while that task has an active attempt.

Readiness is derived from each prerequisite's current human Completion matching
its current `workRevision`. Reopening or changing prerequisite work invalidates
readiness immediately. Expose blocked prerequisite IDs and accepted/current
revisions in task reads. Metadata edits that leave `workRevision` unchanged do
not invalidate acceptance. An empty prerequisite set is ready.

Readiness gates registration of a new implementation attempt, in the same
transaction as task version/revision capture. Return `409 dependencies_not_ready`
with bounded prerequisite reasons. Review/verification reports and existing
attempt reports retain their current contracts. Changing readiness does not stop
an external process, cancel an attempt, or prevent manual tracking moves.
A task completion command also rechecks dependency readiness transactionally.
This prevents acceptance while a prerequisite is currently unaccepted.

A browser-only per-task policy has `reviewRequired` and `verificationRequired`
(default false), editable with task version and no active attempt. Required
review/verification decisions bind `{ workRevision, artifactRef, reworkRound }`.
`artifactRef` is a harness/operator-supplied opaque string of at most 2000
characters identifying immutable evidence, such as a commit SHA plus report ID;
its optional display URL remains inert. AgentFlow does not verify its contents.
Implementation success may report this optional reference; tasks requiring gates
cannot be accepted without a reference for the current successful work.

Review and verification runs capture that tuple at registration and require the
current revision/reference/round. Their success events require `decision` from
`approved` or `changes_requested` plus bounded evidence note. A successful run
without the appropriate explicit decision is execution evidence, not approval.
Reporter decisions are labeled reported evidence; they are never human acceptance.
A manual task may receive an operator-supplied artifact reference through a
browser-only command so its required gates can run without implementation history.

A browser-only `POST /tasks/{id}/rework` requires current version and reason,
no active attempt, and `review` state. It returns to backlog, advances
`workRevision` and `reworkRound` once, and preserves old decisions. New work,
reopen, a new implementation attempt, or an artifact-reference replacement
invalidates prior approval applicability. Replacing the reference advances the
work revision; it is rejected during active attempts. Round changes only on
explicit rework and begins at 0. Never retarget an old approval to newer work.

Completion retains every foundation condition and browser-only authorization;
add required current-tuple approvals and dependency readiness. A current
`changes_requested` decision from either required gate blocks acceptance until
rework/new revision and fresh approvals. Optional decisions remain visible
without enforcing gates. No observation, gate, PR merge, or parent completion
automatically completes a task.

Proposed additions: `PUT /tasks/{id}/dependencies`,
`PATCH /tasks/{id}/review-policy`, `POST /tasks/{id}/artifact`,
`POST /tasks/{id}/rework`, and `GET /tasks/{id}/readiness`.
Extend run registration/success schemas and completion validation additively;
new mandatory fields apply only when the relevant task policy requires them.
Planned files: task/run contracts and domain commands, dependency/decision schema
and migrations, task panel readiness/evidence controls, integration/e2e tests.
Pass with diamond DAG and cycle cases, competing prerequisite reopen/registration,
stale revisions/references/rounds, required negative decisions, manual evidence,
and human-only completion. Prove no process action and no parent-derived gate.

## W03a. Optional read-only GitHub PR metadata

Implement an opt-in connection for an exact browser-selected allowlist of
`owner/repository` identifiers. Disabled by default. The only outbound exception
to the foundation API is this adapter fetching GitHub PR metadata for selected
repositories; never fetch arbitrary evidence URLs, local paths, or redirects to
unapproved hosts. No GitHub write, review submission, merge, webhook server,
repository clone, or agent-provider integration.

Use an explicit browser refresh command and bounded page queries, not continuous
background polling. Store PR number, canonical URL, title, state, draft flag,
head SHA, base branch, merged time, source fetch time, and last refresh error.
No PR body, diff, comments, or author profile is needed. A changed head SHA marks
previously displayed head-linked evidence stale; it cannot modify task acceptance.
GitHub status is external metadata, never proof of local work or human acceptance.

Credentials live only in user-only files outside the checkout, configured through
local setup without values in shell history, URLs, logs, exported data, or UI.
Never ask for credentials in a public issue/PR. Browser commands select connection
metadata and repositories, not secret values. Respect rate limits, bounded timeouts,
and safe error redaction. Verify exact current GitHub API/version/auth requirements
in W03a against official documentation before choosing the adapter implementation.

Proposed browser-only routes: `GET /connections/github`,
`PUT /connections/github/repositories`, `POST /connections/github/refresh`.
Settings changes use version checks/receipts; refresh has a bounded asynchronous
or synchronous result with fetched time and partial errors, without secret output.
Planned files: GitHub adapter/contracts, settings schema, routes, Settings/task PR
metadata views, mocked HTTP boundary and optional live integration evidence.
Pass with disabled mode causing zero outbound calls, exact allowlist, redacted
errors, pagination/timeouts/rate limits, changed head, and offline stale display.
Adapter fixture tests are required; missing live credentials are an explicit
unverified limitation, never a fabricated successful connection.

## W03b. Export and conservative retention

Default: retain all history. Export authenticated snapshot data as versioned
JSON Lines with manifest schema version, generation, cursor, creation time, and
record counts. Exclude credentials, sessions, connection secrets, and filesystem
secret paths. Export is a local user-requested download, not upload or backup.
Create an isolated SQLite snapshot using the existing backup facility, then stream
bounded batches from it; delete the temporary snapshot after completion/abort.
Avoid a long-lived read transaction on the live database. Release resources on abort,
and test concurrent writes. v1 has no import or export-resume endpoint: interruption
starts a new export, so no cursor can silently combine different snapshots.

A browser-only prune preview proposes only old raw progress/heartbeat display
payloads from terminal runs and obsolete change-feed rows, before an explicit UTC
cutoff. The service makes and integrity-checks a local backup before a confirmed prune;
backup failure prevents pruning. A confirmed command binds the preview ID, current generation/version,
and unchanged candidate digest; changed candidates require another preview.
Preserve tasks, completions, dependencies, revisions, decisions, artifacts, run
terminal evidence, event IDs/sequences/digests, and original acknowledgement and
request receipts indefinitely. Thus old exact retries still work and cannot insert
again. If safe eligibility is uncertain, retain the record. No active-run payload,
current acceptance evidence, or graph reference is pruned. Display a retained
history stub and payload-pruned time; do not imply complete original history.

Prune commits removals and a new stream generation atomically; invalidate active
subscriptions with reset and require full snapshots. Keep sessions valid here
(restore still invalidates them). Old-generation reconnects reset; old list/export
cursors fail cleanly. Retry receipts keep historical metadata with the current
response generation header. CLI outbox sequences remain compatible because all
event identity/receipt ledgers survive. Disk savings can be modest; report them.
Proposed routes: `GET /export`, `POST /retention/preview`, `POST /retention/prune`.
Planned files: export/retention queries and commands, schema/migrations, Settings
controls, real SQLite/API/browser recovery tests. Pass with aborted export,
concurrent writes, expired previews, protected evidence, pre-prune exact retry,
gap/conflict detection after prune, two-tab reset, restart, and backup/restore.

## W03c. Reported usage and optional estimates

Accept `run.usage` reports only while an attempt is running, ordered through the
existing run-event envelope. Each payload has a stable `usageId`, source label,
model label, measurement timestamp, and nullable nonnegative integer `inputTokens`
and `outputTokens`. Counts are incremental deltas, not cumulative snapshots;
`totalTokens` is derived only if both counts exist. Unknown means null, never zero.
Unique `(runId, usageId)` rejects a changed measurement and deduplicates an identical
one even with a fresh event ID; commit sequence acknowledgement without adding
usage twice. Event retries retain the usual exact-digest contract.

Group summaries by source/model with known subtotals and unknown-report counts;
include eligible run count, runs with reports, and runs with no reports so absent
reporting cannot look like complete coverage. Use server receipt time for interval
selection and label producer measurement time separately;
never present a partial subtotal as complete usage. `GET /usage` requires project
and a UTC interval no longer than 31 days, paginates run detail, and bounds group
results. Include server receipt time separately from producer measurement time.

Optional local named price snapshots contain model/source, currency, effective
or captured time, and input/output prices per million tokens. No live pricing
lookup is required. Estimate only matching reports with both counts and a complete
price snapshot; label snapshot and excluded unknowns. Use decimal-safe arithmetic;
never label an estimate a bill. Cache-token tiers or other unrepresented billing
dimensions make the report ineligible for a complete estimate.
Planned files: usage schemas/ledger/query, optional price settings, report CLI,
usage view, integration/summary tests. Pass with unknown counts, duplicate logical
measurements, conflicting usage IDs, restart, date bounds, mixed models/sources,
partial prices, and preserved totals after payload retention. W04 owns release.
