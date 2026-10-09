# AgentFlow v1 roadmap

Status: planned. On 2026-10-09 the operator changed the release target from v0.1
to v1 and requested completion of all three phases in order from one implementation
prompt. This PR records that scope and delivery plan. Implementation is unstarted.

## Release boundary

v1 is the complete local task and workflow-observation application: foundation,
agent integration, workflow graphs, dependencies, review/rework tracking, opt-in
GitHub PR observation, export/retention, and reported usage analytics. The selected
Work board uses the [lightly cartoonish design](DESIGN.md).

| Order | Phase | Packages | Gate before proceeding |
| --- | --- | --- | --- |
| 1 | Foundation | P01–P03 | Persistent project/task board, accessible manual journey, human acceptance |
| 2 | Agent integration | P04–P07 | Reliable reports, CLI outbox, live views, recovery, isolated-install checkpoint |
| 3 | Workflow tracking and supporting tools | W01, W02, W03a–W03c | Reported graph, dependencies, revision-bound reviews, integration/export/usage features |
| 4 | Full v1 release validation | W04 | All phase gates, migration/recovery, independent review, `v1.0.0` source release |

Follow [PLAN.md](PLAN.md) and the [execution policy](docs/EXECUTION_POLICY.md).
P07 is an internal integration checkpoint; it no longer publishes v0.1. Do not stop
at a manual board, P07, or a graph-only demo and call the v1 objective complete.
The [single starting prompt](docs/EXECUTION_POLICY.md#starting-the-future-run)
activates the future implementation run. Saving this plan does not start it.

## Phase 1. Foundation

- [ ] P01: local runtime, SQLite, local authentication, migration and recovery.
- [ ] P02: project/task contracts, comments, versions, acceptance and history.
- [ ] P03: Overview, projects, Work board, task detail, settings and pairing.

One project has Backlog, In progress, Review, and Completed. Preserve title,
description, acceptance criteria, priority, tags, assignment, blocker, parent task,
and repository/PR metadata. Completed requires evidence recorded through a human
browser session. Records must survive restart and concurrent edits must conflict
safely. The design's desktop and narrow studies specify intent, not passing UI tests.

## Phase 2. Agent integration

- [ ] P04: agent identities, attempts, ordered/idempotent event ingestion.
- [ ] P05: SSE recovery, freshness, run timelines, Agents and Activity views.
- [ ] P06: generic CLI hooks, durable outbox, executable producer walkthrough.
- [ ] P07: production installation, load, recovery and security checkpoint.

External tools start and coordinate agents. AgentFlow sees only explicit reports.
An implementation success reaches Review, not Completed. Stale reports are
uncertain; closing a tracking record never stops a process. One active attempt
per task remains the v1 rule; parallel agents work on separate linked tasks.

## Phase 3. Workflow tracking and supporting tools

- [ ] W01: versioned reported plans, workflow runs, graph/list view, node evidence,
  assignments, and optional reported skill metadata.
- [ ] W02: same-project dependency DAGs, readiness explanations, revision/artifact
  bound review decisions, and explicit rework rounds.
- [ ] W03a: opt-in, read-only GitHub PR metadata synchronization for selected repos.
- [ ] W03b: explicit export and retention controls, defaulting to retain all history.
- [ ] W03c: reported usage summaries with unknown-data handling and attributable
  cost estimates only when a complete named price snapshot is available.

The [Phase 3 contract](docs/V1_WORKFLOWS.md) defines the bounded implementation
scope. These capabilities are required in v1 even when an individual operator
chooses not to connect GitHub, report usage, or prune history. A missing optional
connection is an empty/configuration state, not permission to omit the feature.

Dependencies explain/gate accepted tracking records; they do not run a scheduler.
A graph reflects reports and exposes missing observations. Parent-child grouping
is distinct from dependencies. Review evidence never impersonates human acceptance.

## Full v1 acceptance

- [ ] W04: finish all package gates and validate the integrated v1 journey on a
  fresh checkout with isolated data/outbox directories on the named macOS host.
- [ ] Trace a branching workflow, failed attempt, retry, stale report, review,
  rework, updated artifact, human acceptance, and reconnect across two browsers.
- [ ] Verify GitHub opt-in/offline recovery, exports, safe retention/cursor reset,
  usage deduplication, and unknown-data displays.
- [ ] Review the exact release commit and publish `v1.0.0` only under activated
  execution authority, with evidence and disclosed limitations.

The tested host configuration is the support claim. Linux requires equivalent
installation/runtime evidence. Normal local use works offline; explicitly enabled
GitHub synchronization and external agent providers need their own network access.

## Separate future proposals

Agent process controls, multiple users, LAN access, cloud synchronization, custom
columns, arbitrary command execution, transcript indexing, native mobile clients,
a plugin marketplace, installers, and desktop packaging remain outside v1. The
previous optional control release was never one of Phases 1–3.

MIT remains selected for AgentFlow-owned material. Exact compatible dependencies
and runtime versions are pinned and validated in P01 and the package adding them.
