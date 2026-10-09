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

This applies the Poteto Model the Domain principle. A run outcome, observation freshness, and task completion are different facts, so they have different representations. Phase 3 can introduce revision-bound automated approval policies after defining what evidence qualifies.

One active run per task bounds automatic transitions in v0.1. Parallel agents use child tasks. This restriction may be revisited with explicit ownership semantics; removing the index alone would be incorrect.

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
