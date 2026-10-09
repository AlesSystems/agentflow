# Architecture decisions

These decisions record the user-approved product direction and implementation choices from 2026-10-09. The operator accepted ADR-004 through ADR-007 through the consolidated [execution policy](EXECUTION_POLICY.md). Runtime evidence is pending the work packages in [PLAN.md](../PLAN.md).

## ADR-001. Build an original local application

Accepted direction. Use Next.js, React, TypeScript, and SQLite. Keep tasks, run history, and credentials on the operator's machine. Source code is public under AlesSystems; runtime data is private and outside the checkout.

A Fizzy fork was considered. The user selected an original app so agent-specific domain rules can be designed directly. No existing Fizzy implementation or assets are reused. The operator selected MIT for AgentFlow-owned material; see [LICENSE](../LICENSE).

## ADR-002. Observe the existing harness

Accepted direction. AgentFlow manages task records and observes explicit reports. The existing harness owns agent creation, execution, credentials, cancellation, and worktrees. Assigning a task or closing a stale tracking record does not control a process.

A control dashboard was considered and deferred. Launching commands would introduce a different trust boundary before reporting reliability is established. Future controls require a new proposal rather than additions hidden inside event endpoints.

## ADR-003. Use a generic integration contract first

Accepted direction. A versioned local HTTP API and CLI hooks provide the first integration. Agent identities are stable; run IDs identify individual attempts. Provider names and model labels are metadata.

Codex-first and Claude-Code-first integrations were considered. Generic reports support the user's mixed-agent workflows without relying on undocumented storage or presumed hooks. Specific adapters follow only after a supported mechanism is verified.

## ADR-004. Separate execution from human acceptance

Accepted implementation choice. Implementation success moves work to Review. Completed requires human session acceptance for the current work revision, recorded with evidence. Review and verification runs supply observations but cannot assert human acceptance.

This applies the Poteto Model the Domain principle. A run outcome, observation freshness, and task completion are different facts, so they have different representations. W02 introduces configured revision/artifact-bound reported evidence gates under
[V1_WORKFLOWS.md](V1_WORKFLOWS.md), while preserving human-only completion.

One active run per task bounds automatic transitions in v1. Parallel agents use child tasks. This restriction may be revisited with explicit ownership semantics; removing the index alone would be incorrect.

## ADR-005. Prefer retry-safe ordered ingestion

Accepted implementation choice. Each run has one producer, stable event IDs, strict sequence order, and a durable outbox. A transaction commits each event, projection, change record, and acknowledgement together. Duplicate delivery returns the stored result.

This applies Make Operations Idempotent. A retry after an uncertain response must recover the prior result rather than duplicate it. Arbitrary out-of-order acceptance was considered but would require buffering or more complex projection rules. The first release rejects gaps and requests the missing event.

The tradeoff is that a lost outbox entry can strand a run's stream. The documented recovery is to close the stale record and register a new attempt. AgentFlow does not invent missing events.

## ADR-006. Keep one local application and a durable feed

Accepted implementation choice. Next.js Node routes, Drizzle, and SQLite form one application. A durable change table supplies SSE replay. Polling that table initially avoids relying on a process-local emitter for correctness.

This applies the Laziness Protocol. Redis, a message broker, microservices, and a full event-sourcing framework do not solve an initial requirement. Short transactions and bounded queries are still required because the selected SQLite driver is synchronous.

Runtime compatibility, locks, streaming behavior, and load budgets are unproven. P01, P05, and P07 supply the evidence before release. A build passing alone is not sufficient.

## ADR-007. Treat localhost as a network boundary

Accepted implementation choice. Bind to loopback and authenticate private reads, writes, and SSE. Distinct pairing and reporter credentials keep reporting hooks separate from browser acceptance commands. Exact Host/Origin validation, session cookies, JSON-only mutations, and browser-only acceptance reduce accidental exposure. Runtime data and tokens remain outside Git.

A same-user process can still read local credentials. This application does not attempt operating-system isolation. LAN access and multi-user authorization remain out of scope.

## Evidence still required

| Unknown | Owner package | Required evidence |
| --- | --- | --- |
| Driver and Node compatibility | P01 | Clean install, transaction, backup, and production-build execution |
| Local bootstrap and instance lock | P01 | Pairing, duplicate-instance, crash/restart, and revoked-session cases |
| Task acceptance and retry semantics | P02/P04 | HTTP concurrency, duplicate, gap, and crash tests against real SQLite |
| Chosen dnd-kit interaction | P03 | Pointer and keyboard journeys using the pinned API |
| Next.js streaming and replay | P05 | Production stream, snapshot race, reconnect, and resource cleanup |
| CLI outbox guarantees | P06 | Restart, duplicate acknowledgement, disk limit, and missing-record cases |
| Performance and offline behavior | P07 | Named-machine load samples and network-disconnected browser journey |

Foundational Thinking shaped the order of work. Runtime and domain contracts come before the UI and integrations. Sequence Work into Verifiable Units shaped the P01-P07 PR boundaries. Prove It Works requires evidence from the real HTTP, SQLite, CLI, and browser paths when those paths exist.

## ADR-008. Target all three phases for v1

Scope accepted by the operator on 2026-10-09: replace the v0.1 target with v1 and
complete Phases 1–3 in order from one implementation prompt. P07 becomes an
internal checkpoint. W01–W02, W03a–W03c, and W04 are required before `v1.0.0`.
The optional process-control release remains separate; the observer boundary and
human acceptance rule continue to apply.

The [Phase 3 contract](V1_WORKFLOWS.md) records proposed detailed choices: immutable
reported graphs, separate dependency policy, tuple-bound review/rework, opt-in
read-only GitHub metadata, conservative explicit retention, and attributed usage.
These details are planned choices for the future activation prompt, not evidence
of prior per-feature approval or implementation. [EXECUTION_POLICY.md](EXECUTION_POLICY.md)
separates the earlier approved P01–P07 authority from explicit expanded activation.

A single prompt coordinates bounded workers and independent reviewers outside
AgentFlow, proceeding package by package after proof and integration. A durable
ledger enables resume; external access/protection blockers remain honest stops.
This avoids requiring a new routine prompt per phase without promising that a
long run cannot be interrupted.


## ADR-009. Keep P02 commands and acceptance in the owned Store

P02 implementation candidate follows the approved Astra medium plan hash recorded
in [P02](implementation/P02.md). A flat typed command/snapshot capability hides
SQLite transaction, receipt, cursor and projection knowledge. Pure task decisions
hold lifecycle rules. Separate repository coordination was rejected because no
second persistence consumer requires it. A strict typed endpoint registry is the
shared boundary for HTTP roles, schemas and generated OpenAPI.

Immutable comments may append to completed tasks in an unarchived project.
This adds context without editing accepted work, changing task revisions or
replacing current human acceptance. Archived projects remain read-only. Reporter
credentials still cannot complete/reopen tasks or update settings, including retries.
Synthetic acceptance fixtures prove browser-only transport and persistence;
they never claim actual human attestation.

Original parsed JSON supplies receipt identity before normalization. JSON key
order and formatting whitespace are irrelevant; string whitespace and omitted
versus explicit values remain significant. Receipt replay returns the exact
committed status/body. Current generation remains a response header even when
the stored body belongs to an older generation or task version.

Finite Intl sampling cannot establish arbitrary historical timezone transition
assumptions. The approved fallback uses exact-pinned `@js-temporal/polyfill` 0.5.1
start-of-day semantics, with literal DST/repeated-midnight/skipped-date regression
fixtures before query implementation. This avoids a silent offset approximation.
Host ICU timezone data remains a qualified dependency, and six fixtures are not
presented as universal proof.

Agents/runs are persisted prerequisites for real assignment, active-run and
acceptance gates. Their public reporting API stays in P04. Workflow archive
checks stay in W01, where workflow records first exist. P02 updates older-prefix
and interrupted-marker restore so P01 backups remain usable without replacing
an original database before candidate migration succeeds.


### P02 latest-run adjudication condition

Astra approved implicit rowid latest-run ordering only within current P02. It
handles tied server timestamps without treating random UUID order as registration
order. This is not a guarantee through VACUUM or table rebuilding. The runs UUID
TEXT primary key does not alias rowid.

P04 must introduce an explicit immutable unique durable registration order before
its first public registration, preserve migration 0001's checksum and backfill
existing rowid order, allocate non-reusing values transactionally, and migrate both
latest queries. Acceptance includes timestamp/UUID ties, later failure and current
revision gates, restart, backup/restore, VACUUM and a representative table rebuild.
P04 Astra approval must include that prerequisite. PLAN and BACKEND retain it.
Earlier registration, deletion, VACUUM or a runs rebuild would invalidate the
bounded approval and require the durable field first.

## ADR-010. Preserve registration order within retained history

P04 Stage 1 follows the exact approved Astra plan recorded by the coordinator.
Add migration 0002 without changing 0000 or 0001. Dense backfill preserves prior
rowid order, including negative or sparse legacy rowids. Explicit immutable unique
positive safe integers drive both latest-run detail and implementation acceptance.
Legacy records remain observations without invented registration identity.

A durable singleton high-water outlives deletion of any run. Immediate write
transactions read its next value; database insert guards and an AFTER INSERT
trigger advance it atomically. This also rejects direct reuse of a deleted order
and replacement of an existing run identity. Allocator insertion, deletion,
reset, decrease and overflow fail. Failed transactions may reuse uncommitted
values. No external allocator or generic persistence framework is introduced.

An older stopped-service restore reinstates retained orders and high-water under
a new generation, with session revocation. It cannot preserve discarded later
history; order values in that discarded history may recur. UUIDs remain public
identities. Registration/event receipt recovery awaits the public Stage 2 paths.

Reviewed trigger SQL requires body BEGIN/END. Replace the blanket keyword guard
with a bounded conservative token recognizer, rejecting top-level transaction
escapes and all body controls while respecting quotes/comments and CASE END.
The runner retains its outer immediate transaction and backup-before-upgrade.
Independent exact-candidate migration review must pass before public registration
implementation begins.
