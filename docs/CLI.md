# Report external work through CLI hooks

The harness owns execution and scheduling. AgentFlow observes reports through
public HTTP. These local commands require the pinned Node runtime and installed
project dependencies. They do not install a global executable or provider adapter.
The administrative `npm run local` setup, backup, restore, and credential rotation
commands remain separate.

## Configure the producer

Run `npm run local -- setup` in an interactive terminal with the service stopped
to view the local reporter credential. Store that credential in an existing
owner-only regular file with mode `0600`. The file contains exactly 64 lowercase
hex characters, without a trailing newline. Use your private credential tooling
to create it; never put the token in a shell command, URL, query, or log.
Set these paths in the producer environment.

```sh
export PORT=3000
export AGENTFLOW_REPORTER_TOKEN_FILE=/absolute/private/reporter-token
export AGENTFLOW_OUTBOX_DIR=/absolute/private/producer-outbox
```

Only loopback HTTP at `127.0.0.1` is supported. Ports range from 1024 to 65535.
`--port` overrides `PORT`. Arbitrary URLs, redirects, proxies, inline tokens, and
host overrides are rejected. Input files contain bounded UTF-8 JSON objects.
Unknown or duplicate flags fail. Run commands from the project checkout.
Use direct Node or `npm run --silent agentflow -- ...` to avoid npm banners
that echo private file arguments and pollute JSON output.

The default outbox is `~/Library/Application Support/AgentFlow-outbox`, separate
from service data. A new outbox reads authenticated `/settings` before mutation
to establish the actual service path and generation. An explicit
`AGENTFLOW_DATA_DIR` must agree. Existing associations permit offline preservation
against the pinned destination. Destination changes and canonical path overlap
with service data or the active checkout fail safely. Existing unsafe permissions,
symlinks, and nonregular files are rejected rather than repaired automatically.

## Register references and attempts

These examples use synthetic data and fake UUIDs. Prepare the JSON file first,
then use a fresh UUID idempotency key for each intentional registration.

```sh
node --import tsx src/cli/main.ts project create --file /private/synthetic/project.json --idempotency-key 10000000-0000-4000-8000-000000000001
node --import tsx src/cli/main.ts task create --file /private/synthetic/task.json --idempotency-key 10000000-0000-4000-8000-000000000002
node --import tsx src/cli/main.ts agent register --file /private/synthetic/agent.json --idempotency-key 10000000-0000-4000-8000-000000000003
node --import tsx src/cli/main.ts run register --file /private/synthetic/run.json --idempotency-key 10000000-0000-4000-8000-000000000004
```

Project and task create files cannot supply IDs. Agent registration accepts an
optional ID. Run registration requires a client UUID, registered project and agent,
purpose, and, except for planning, a task ID. A task-linked attempt requires the
fresh public task version as `expectedTaskVersion`. See [API.md](API.md) for schemas.

Registration preserves the original request before HTTP. Retry an uncertain
registration with the same original file and idempotency key, or use `flush`.
Changing the request under the same key returns code 3 and retains the first
request. Registration output contains only `id` and current header `generation`.
Entity names, repository paths, task text, and metadata stay out of output.
Run initialization checks a fresh public GET, never a historical receipt's zero
sequence. A sole producer may adopt a current sequence-zero run. An advanced run
without its original local producer state fails closed.

## Report and flush

```sh
node --import tsx src/cli/main.ts report --run 20000000-0000-4000-8000-000000000001 --type run.started --payload /private/synthetic/empty.json
node --import tsx src/cli/main.ts report --run 20000000-0000-4000-8000-000000000001 --type run.heartbeat --payload /private/synthetic/empty.json
node --import tsx src/cli/main.ts report --run 20000000-0000-4000-8000-000000000001 --type run.progress --payload /private/synthetic/progress.json
node --import tsx src/cli/main.ts flush --run 20000000-0000-4000-8000-000000000001
node --import tsx src/cli/main.ts flush
```

An empty payload is `{}`. Progress requires `message` and may include integer
`percent` from 0 to 100. Success requires `summary` and may include `evidenceUrl`.
Emit a heartbeat every 15 seconds while running. Queued and terminal attempts
reject heartbeats. The harness decides when to emit reports and whether a reporting
failure affects its job. There is no background reporting daemon.

Each `report` creates another logical observation. It allocates a UUID, occurrence
time, and sequence under a stable OS-held publication lock. It preserves the exact
original envelope before sending. Hook subprocesses can share one producer outbox.
Independent outboxes must not report the same run. After uncertain delivery,
use `flush`; another `report` creates another event. Output contains only the typed
acknowledgement and current header generation.

A stable delivery lock allows one sender. Network work releases publication
ownership so other subprocesses can preserve observations. Multi-run flush uses
a durable fair cursor across registration and run work. Global event selection
and durable publication of the existing scheduler successor share one publication
owner. Empty selection writes no cursor. Targeted report or `flush --run` leaves
the global cursor unchanged. Registration dependencies keep their separate path.
Every actual acquisition fully validates and recovers owned files, pins,
permissions, sidecars, contiguous identities, current logical lengths, and remaining
peak reservations. There is no cache across owners or same-value write elision.
Each invocation retains a five-second retry budget, including validation reads,
with turns bounded by the remaining invocation budget and 500 ms. Retryable network, 429, and
503 responses use bounded backoff. Blocked work retains its record while independent
work can progress. The CLI advances the durable acknowledged watermark before
removing and syncing an event file. Its completion result describes current
allocated work under that ACK owner. Reports enqueued afterward remain for their
own or a future flush. IDs, sequences, and request digests remain unchanged on retry.
For local deadline failures, only proven native admission or lock-wait expiry
with durable pending work returns
queued 2. Actual recovery, cursor, rollback, or noncontention SQLite I/O failure
remains local 1. Corruption, coverage, and permission checks still fail closed.

| Exit | Meaning |
| --- | --- |
| 0 | Selected work delivered, or no selected work remains |
| 2 | Observation durably queued after retryable failure or competing sender |
| 1 | Invalid input, local failure, or preservation cannot be established |
| 3 | Delivery blocked until references, credentials, lifecycle, or producer state are repaired |

Multi-run precedence is 1, then 3, then 2, then 0. Read the safe error code and
optional run/version/sequence fields. Preserve the outbox before repair. Code 1
is not proof that a report was queued. A server terminal-state, identity, or sequence
conflict cannot be fixed by issuing another observation or changing a retained file.

## Keep the outbox and restore limits explicit

Quota is 10 MiB per run and 100 MiB globally. The metric is the sum of logical
regular-file lengths for owned records, metadata, journals, locks, sidecars,
temporary copies, and damaged retained files. It excludes filesystem allocated
blocks, directory metadata, sparse allocation, and APFS copy-on-write overhead.
Metadata and transient publication copies need headroom. Lock bootstrap reserves
64 KiB globally before initializing the two stable lock families. Remaining peak reservations are recomputed at each publication acquisition,
including an already-open process following another owner's crash. Quota or fsync
failure prevents a success or durable-queued claim. Nothing silently drops pending
observations. Do not modify, replace, or delete stable lock files while producers run.

Keep the whole outbox to preserve sequence ownership and acknowledged watermarks.
When restoring an older service backup, current-generation validation compares
remote sequence with local watermarks. A server prefix shorter than the locally
acknowledged prefix blocks delivery because removed observations cannot be
reconstructed. A server prefix beyond locally allocated sequence also blocks.
Retained exact acknowledgements can replay under a new generation, but their bodies
are historical. Queued data is never automatically cleared, resequenced, or remapped.

Restore can discard project/task references because their create schemas cannot
adopt original IDs. Explicit recreation and remapping require new intentional
requests and keys after public reads. Missing runs may require supported explicit
re-registration. Lost producer state for an advanced run requires restoring the
original outbox or a new attempt. Reporter credentials cannot complete, reopen, or
close stale tracking to bypass these limits. Implementation success moves a task
to Review; separate review or verification success remains evidence for a human.

## Run the executable synthetic walkthrough

Create a fresh private scratch directory outside the checkout and service data.
Set `AGENTFLOW_PRODUCER_DIR` to it. The producer rejects canonical overlap with the checkout, public service location, or outbox before writing inputs. Run this online walkthrough.

```sh
node --import tsx scripts/p06-producer.ts
```

The script uses fresh actual CLI subprocesses for project, task, two agents, and
implementation and verification attempts. It emits safe checkpoint facts and
sanitized CLI transcripts. Public task GETs supply fresh versions. Both attempts
report start, running-only heartbeat, and success. The task remains in Review.
The default does not simulate downtime or claim offline proof.

For a harness-controlled downtime journey, use `--controlled`. Read each JSON
checkpoint and write exactly `continue` followed by a newline to stdin.
At `offline-request`, stop the synthetic service before continuing. At `queued`,
restart that service on the same port and data directory before continuing.
The script creates the offline observation once, then invokes fresh CLI `flush`.
Continue other checkpoints after observing their public API or browser state.
The final `done` checkpoint requires no response. The external harness owns
service lifecycle and browser pairing. Never run this synthetic controller against
operator data. Producer input files are retained on failure for inspection.

[The P06 receipt](implementation/P06.md) records the producer journey, failed and
passing performance attempts, fresh production verification, and pending final review.

## Reported workflows

Use `register workflow --file FILE --idempotency-key UUID`,
`register workflow-revision --workflow UUID --file FILE --idempotency-key UUID`
and `register workflow-run --file FILE --idempotency-key UUID` to publish a plan
and bind an observed attempt to its immutable revision. Workflow and revision
files carry explicit IDs; revision publication requires expectedWorkflowVersion.
The revision acknowledgement is compact; read the full immutable plan from its
named revision endpoint. Workflow-run files contain id, workflowId and planRevisionId.

`report --workflow-run UUID --type workflow.started --payload FILE` uses a distinct
producer namespace. The selector is mutually exclusive with `--run`; old commands
and old outbox records retain task-run behavior. Node reports use
`workflow.node.reported` and a payload with nodeId, reported state, optional linked
runId and inert reportedSkill. Heartbeats, success, failure and cancellation have
their strict public workflow schemas. Reports do not complete linked tasks.

A validated durable workflow-run registration establishes local sequence authority
before delivery. With an existing destination association, an offline producer can
preserve a never-delivered workflow, revision, attempt and reports. Flush orders
those resource dependencies. A rejected parent keeps its dependent prefix; other
producers still progress. Registration replay never resets allocated sequence state.
Workflow spool leaves live under `workflow-runs/<UUID>` with explicit producer kind;
task leaves remain `<UUID>`. Same UUIDs remain independent through native leases,
accounting, pending descriptors, recovery, ACKs and fair cursor scheduling.

`flush --workflow-run UUID` selects that producer; ordinary `flush` includes both
kinds and pending registrations. Existing exits 0/1/2/3 and 10 MiB per-producer,
100 MiB global limits apply. Preserve the outbox after a blocked prefix or uncertain
reply. No command launches, stops or inspects an external agent process.

Task-create delivery requests `Prefer: return=minimal` while retaining the original
outbox path, body, key and digest. The CLI validates the strict compact task reply
or the existing strict full reply from an older server, including known project,
parent/assigned-agent bindings and original creation versions. Compact replies must
acknowledge the preference. The 65,536-byte reader limit is unchanged.

Task IDs are generated by the service. The CLI validates canonical compact ID
shape and known bindings; it cannot independently recognize substitution of another
valid generated task UUID from its request alone. Exact API replay proves stable
identity under the original key. An older server whose full creation reply exceeds
the limit remains exit-3 blocked with original bytes retained. Upgrading the service
allows flush of that same retained registration through the bounded representation.
Default browser/API task replies and full event acknowledgements remain unchanged.

The retained P06 helper `--smoke` controls use a stopped baseline-schema dataset
and normal head upgrade. Smoke baseline dependencies and production assets must
come from that baseline source; an explicit prepared checkout may be selected with
`AGENTFLOW_P06_SMOKE_BASE_SOURCE`. Its receipts remain `acceptance: false` and do
not qualify W01 performance. Historical P06 acceptance prerequisites remain intact.
The real P07-to-current blocked-task upgrade regression requires the separately
prepared P07 checkout selected by `AGENTFLOW_W01_BASE_SOURCE`; package verification
supplies it explicitly. An unconfigured ordinary test invocation skips that single
historical-source prerequisite rather than claiming an upgrade was exercised.

The [W01 receipt](implementation/W01.md) records the configured real upgrade,
valid bounded full-reply fallback control, original typed spool/ACK/database joins
and one quiet performance invocation. CLI timings include real process startup
and native work through EXIT, with complete output drain awaited afterward. They
use their documented delivery/kill bounds and relative comparison, not the HTTP
query's 250 ms absolute budget. Graph controls never execute these commands.
