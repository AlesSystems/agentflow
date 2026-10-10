# AgentFlow

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Engineers managing local projects, tasks, and reports from external agent
harnesses. One operator uses one application instance on their own machine.
The user confirmed this audience and the existing repository plans on 2026-10-09.

## Product Purpose

Make engineering work and its reported execution history easy to inspect on a
simple board. Success means the operator can identify work needing attention,
inspect evidence, and record human acceptance of a task's current work revision.

## Positioning

Task management and explicit harness reports share one local record. Execution
outcome, reporting freshness, and human acceptance remain separate facts.
AgentFlow observes the external harness; that harness owns agent execution.

## Operating Context

Next.js, React, TypeScript, and SQLite are the accepted stack. The initial release
targets a browser on macOS, with a loopback-only server. Generic HTTP reporting
and CLI hooks are the first integration. Normal application use must work offline
after installation; external agent providers may still require network access.

## Capabilities and Constraints

The repository implements the local runtime, project/task API and manual Work
board. P04 reporting APIs are integrated. P05 live tracking is implemented on its
candidate branch with Agents, Activity, reported attempts and separate browser
connection state; final package verification and integration remain open. CLI
hooks and workflow surfaces remain later gated packages. The v1 boundary is all three phases: P01–P07, W01–W02, W03a–W03c, and W04 in
[PLAN.md](PLAN.md). This supersedes the earlier v0.1 target.

- Each project has Backlog, In progress, Review, and Completed columns.
- Successful implementation runs move tasks to Review. Human acceptance with
  evidence is required for Completed; reopening permits later edits.
- One active run per task; parallel agents use separate tasks in v1.
- Task details retain acceptance criteria, comments, repository/PR metadata,
  run history, blockers, and completion evidence.
- Reports describe observed state. Stale reports remain uncertain; closing a
  tracking record does not stop an external process.
- Browser connectivity and agent reporting freshness are distinct.
- Runtime data and credentials stay outside the public checkout. No telemetry,
  remote fonts, or external asset requests are part of the product design. The
  only app network integration is explicitly enabled GitHub PR observation.
- v1 includes reported workflow graphs, task dependencies, revision-bound review
  and rework, opt-in read-only GitHub PR observation, export/retention, and reported
  usage summaries. [Phase 3 contracts](docs/V1_WORKFLOWS.md) define their bounds.
- Agent process controls, multiple users, and LAN access remain separate proposals.
- MIT is selected for AgentFlow-owned material. Runtime/dependency versions are pinned in
  package.json and the lockfile; [P01 evidence](docs/implementation/P01.md) records compatibility. Installation evidence follows the approved
  [execution policy](docs/EXECUTION_POLICY.md); Linux support requires its own evidence.

## Brand Commitments

Use the AgentFlow name. The implementation and visual design are original.
Fizzy is a reference for a lightweight board experience, with no reused source
or assets. Preserve the frontend plan's light neutral canvas, readable dark text,
readable card outlines, one blue action accent, and offline system fonts. The user
selected the Work board prototype and requested a slightly cartoonish Fizzy-like
refinement on 2026-10-09: rounded colored lane tabs, bold titles, and small
acceptance stamps. See [DESIGN.md](DESIGN.md) for extracted implementation values.

## Evidence on Hand

[README.md](README.md), [ROADMAP.md](ROADMAP.md), [PLAN.md](PLAN.md), and
[docs/DECISIONS.md](docs/DECISIONS.md) establish the delivery boundary and decisions.
[docs/FRONTEND.md](docs/FRONTEND.md) specifies routes, interactions, recovery,
freshness, metrics, and accessibility. Backend/API/architecture documents define
the planned contracts. [P01](docs/implementation/P01.md) adds runnable pairing and
storage readiness, browser captures, runtime/recovery verification and initial
host measurements. [P02](docs/implementation/P02.md) records persistent task contracts and
[P03](docs/implementation/P03.md) records the manual Work board candidate. Workflow
interfaces remain planned; synthetic browser acceptance is not a customer attestation.

## Product Principles

- Show reported facts with their freshness and uncertainty.
- Keep execution success separate from human acceptance.
- Preserve drafts and history through failure and recovery.
- Keep the board simple and expose the evidence behind a decision.
- Treat local data ownership as a product constraint.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Create, edit, move, inspect, accept, and reopen must work
without a pointer. Status has explicit text labels. Respect reduced motion,
retain focus and drafts in task navigation, and associate errors with fields.
Verification must cover 200% zoom and a 375 px viewport. On narrow screens,
use a status selector and full-page task detail rather than compressing four
board columns. These are acceptance targets, not current compliance claims.
