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

The repository is design-only: routes, APIs, and commands describe planned
behavior, not shipped features. The v0.1 boundary is P01-P07 in [PLAN.md](PLAN.md).

- Each project has Backlog, In progress, Review, and Completed columns.
- Successful implementation runs move tasks to Review. Human acceptance with
  evidence is required for Completed; reopening permits later edits.
- One active run per task; parallel agents use child tasks in v0.1.
- Task details retain acceptance criteria, comments, repository/PR metadata,
  run history, blockers, and completion evidence.
- Reports describe observed state. Stale reports remain uncertain; closing a
  tracking record does not stop an external process.
- Browser connectivity and agent reporting freshness are distinct.
- Runtime data and credentials stay outside the public checkout. No telemetry,
  remote fonts, or external asset requests are part of the product design.
- Workflow graphs, dependency enforcement, GitHub synchronization, analytics,
  agent controls, multiple users, and LAN access are deferred.
- License selection and exact runtime/dependency versions remain open before
  release. Linux support requires its own acceptance evidence.

## Brand Commitments

Use the AgentFlow name. The implementation and visual design are original.
Fizzy is a reference for a lightweight board experience, with no reused source
or assets. Preserve the frontend plan's light neutral canvas, readable dark text,
thin borders, one action accent, and offline system fonts.

## Evidence on Hand

[README.md](README.md), [ROADMAP.md](ROADMAP.md), [PLAN.md](PLAN.md), and
[docs/DECISIONS.md](docs/DECISIONS.md) establish the delivery boundary and decisions.
[docs/FRONTEND.md](docs/FRONTEND.md) specifies routes, interactions, recovery,
freshness, metrics, and accessibility. Backend/API/architecture documents define
the planned contracts. There is no runnable UI, visual verification, customer
proof, or performance evidence yet.

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
