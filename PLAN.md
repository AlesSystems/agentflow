# Implement AgentFlow v1

This plan builds the local application described in [ROADMAP.md](ROADMAP.md). P01 is integrated through PR #4; P02 planning is underway. Implementation boxes remain unchecked until each package is reviewed and integrated. P01–P07, W01–W02, W03a–W03c, and W04 are work-package identifiers, not GitHub PR numbers. All three phases are required for v1. See [the Phase 3 contract](docs/V1_WORKFLOWS.md).

## Use the plan

Implement one work package per reviewable PR. Record its commit, commands, actual results, and limitations before marking it complete. Keep small Conventional Commits with one behavior per commit. Add focused failing behavioral tests before implementation when a contract warrants them, then keep later commits green.

Use the accepted [architecture](docs/ARCHITECTURE.md) and [API contract](docs/API.md). Changes to task acceptance, local trust, event order, or the observer boundary require an updated [decision record](docs/DECISIONS.md).

The operator changed the release target to v1 on 2026-10-09. The
[execution policy](docs/EXECUTION_POLICY.md) preserves the earlier approved
P01–P07 controls and supplies an explicit one-prompt activation for the expanded
scope. The operator activated the implementation run on 2026-10-09; this plan
records its sequential gates.
Use relevant skills for each package, including Poteto for implementation and
Impeccable for UI work; do not invoke every installed skill indiscriminately.

## Dependencies and ownership

Complete packages in this order. Integrate a passing, independently reviewed
package before starting the next; do not skip a phase because a later surface
can be mocked sooner.

```mermaid
flowchart LR
    P01 --> P02 --> P03 --> P04 --> P05 --> P06 --> P07
    P07 --> W01 --> W02 --> W03a --> W03b --> W03c --> W04
```

The coordinator owns integration and the evidence ledger. Bounded workers may
work on independent tasks within the current package with disjoint files or
isolated worktrees/data directories. A reviewer checks the exact candidate commit.
No parallel writer shares a SQLite file, branch, or test data directory.

At each package: pin a failing behavioral contract where appropriate; implement
the smallest complete change; run focused checks, lint, types, and build; obtain
independent review; fix findings; record evidence; integrate under activated
authority. Preserve small Conventional Commits. Failed or unavailable checks keep
the package open. Follow [DELIVERY.md](docs/DELIVERY.md) to resume after interruption.

## P01. Prove the local runtime and storage

Depends on no earlier package. Proposed files include `package.json`, lockfile, Node version pin, Next.js configuration, `src/db/`, local launcher/auth modules, and initial integration tests.

- [x] Select exact supported versions. Record Node and better-sqlite3 compatibility using the isolated macOS installation procedure in the execution policy.
- [x] Scaffold Next.js, TypeScript, Tailwind, lint, type checking, Vitest, and Playwright. Define the commands used below.
- [x] Prove SQLite transactions and a streamed response in `npm run build && npm start` before selecting the driver permanently.
- [x] Implement data-directory permissions, loopback binding, exact Host/Origin checks, separate pairing/reporter credentials, protected page/API reads, and session revocation. Prove a reporter token cannot create a session or call human-only commands.
- [x] Implement the single-instance lock, migrations, integrity-checked backup, and stopped-service restore with generation renewal.
- [x] Disable framework telemetry and remove external font/asset dependencies.

Pass when a clean production launch binds only to loopback, an unauthenticated private read fails, and authenticated reads work. A second instance must fail safely. Restart, a failed migration, and restore must preserve the documented data state. Capture listener output, HTTP responses, and the integrity check.

Run the runtime integration suite, lint, type checking, and production build. Measure baseline idle memory and startup time on the named machine. These are initial measurements, not pre-existing performance promises.

## P02. Build project and task contracts

Depends on P01. Proposed files include shared schemas, Drizzle tables/migrations, task domain rules, query/command modules, `/api/v1` task/project/session routes, and generated OpenAPI.

- [ ] Define the entities and allowed transitions in [BACKEND.md](docs/BACKEND.md).
- [ ] Implement project/task CRUD within the documented archive and no-hard-delete limits, comments, completion, and reopen.
- [ ] Store idempotency receipts, optimistic versions, work revisions, and durable change records transactionally.
- [ ] Define snapshot reads, pagination, totals, and Overview metrics with timezone boundaries.
- [ ] Generate OpenAPI from schemas and validate every published request/response example against them.

Pass when HTTP create/edit/move/reopen calls persist across restart, retries return the original result, and stale writes cannot overwrite newer data. Completion must require human session evidence. A forged harness completion must fail. Test parent cycles, cross-project references, archived projects, and daylight-saving boundaries.

Run unit and real-database integration suites. Compare task-list query latency at base and head with the same fixture where available. For newly introduced endpoints, measure against the absolute P07 budget and state that the base has no equivalent operation.

## P03. Deliver the manual board journey

Depends on P02. Proposed files include page layouts, project/board/task components, query-cache integration, and browser tests. Agent run controls are not part of this package.

- [ ] Build Overview, project list, board, task panel, and settings/pairing UI.
- [ ] Implement create/edit, status-menu movement, comments, completion evidence, and reopen before adding drag interaction.
- [ ] Add dnd-kit for cross-column movement through the same command. Do not add manual sorting.
- [ ] Implement filters, load-more controls, empty/loading/error states, and version-conflict recovery.
- [ ] Verify keyboard navigation, focus restoration, reduced motion, contrast, zoom, and a 375 px layout.

Pass when automated real-browser tests complete the full manual journey and its records survive restart. Synthetic acceptance fixtures exercise the human-only browser command without claiming an actual human attestation. Two tabs editing the same task must expose a conflict rather than lose an edit. Dropping into Completed must open acceptance, not bypass it.

Run the focused browser suite plus lint, type checking, and build. Attach board, task-panel, conflict, and narrow-layout screenshots and a short journey recording to the PR. Record board-load timing using the P07 fixture. Obtain independent review of the interaction evidence and exact candidate commit before merge under the execution policy.

## P04. Accept reliable agent observations

Depends on P02. Proposed files include agent/run schemas, run state rules, event ingestion, migrations, HTTP handlers, and integration fixtures.

- [ ] Before public run registration, add explicit immutable unique registration order in a reviewed additive migration, preserve migration 0001's checksum and existing rowid order in backfill, allocate durable non-reusing values transactionally, and move both latest queries to it. Prove tied timestamps, reversed UUID order, later failure/current-revision gates, restart, backup/restore, VACUUM and table-rebuild preservation. Include this mandatory prerequisite in P04 Astra plan approval; see [BACKEND.md](docs/BACKEND.md).
- [ ] Implement agent registration and per-attempt runs, including active-run uniqueness and task version checks.
- [ ] Implement the event envelope, strict sequence policy, exact-duplicate recovery, and terminal-state protection.
- [ ] Commit events, run/task projections, receipts, and change records together.
- [ ] Implement heartbeat freshness and the browser-only close-stale-record action.
- [ ] Update OpenAPI and add a deterministic producer fixture that emits real HTTP requests.

Pass when implementation success moves a task only to Review and does not claim task acceptance. Replay duplicates, conflicting IDs, missing/reordered sequences, unknown references, and terminal regressions. Kill the server before commit and after commit but before the response; retry and inspect actual persisted state. Check two concurrent attempts for the same task yield one accepted owner.

Run domain and HTTP/SQLite integration tests. Capture producer requests, responses, and database counts. Compare ingestion under the same fixture when a base exists; otherwise record new-endpoint latency and the absolute P07 budget. These tests exercise the application's public API, not mocked database methods.

## P05. Show live agent tracking

Depends on P03 and P04. Proposed files include the SSE route, snapshot queries, client subscription, Agents/Activity views, and browser integration tests.

- [ ] Implement authenticated replay from durable changes without retaining database read transactions.
- [ ] Add generation/reset handling, connection limits, slow-consumer disconnect, and abort cleanup.
- [ ] Show agent/run history, reported freshness, failure attention, and task-linked events.
- [ ] Add visible connection state, polling fallback, and full snapshot recovery.
- [ ] Verify that no displayed agent status claims unobserved process liveness.

Pass when two tabs converge after a report and neither misses a write between snapshot and subscription. Disconnect, restart, restore, reconnect, duplicate delivery, expired session, and a slow consumer must follow the documented behavior. Retrying a pre-restore receipt must expose the current generation and trigger a snapshot refresh. Verify fallback polling stops when subscriptions recover and resources release when tabs close. The connected-state 15-second freshness refresh remains active while visible. Prove that silence alone marks a run stale within 75 seconds and updates Overview without another write or navigation. Test a local-day rollover and a lost command response whose retry arrives after a newer task version has loaded.

Run browser and real-server integration tests against a production build. Record report-to-visible latency, bounded stream memory, and a reconnect video. Include stale-agent and disconnected-browser screenshots as separate states.

## P06. Connect a harness through CLI hooks

Depends on P04. Proposed files include `src/cli/`, outbox modules, CLI integration tests, and an integration walkthrough.

- [ ] Implement registration commands and reports using public HTTP contracts.
- [ ] Allocate IDs and per-run sequences under a lock, then preserve reports before delivery.
- [ ] Implement bounded outbox storage, flush, retry/backoff, exit codes, and actionable non-retryable errors.
- [ ] Document token access without URL/query secrets or shell-history examples containing real credentials.
- [ ] Provide an executable external producer walkthrough demonstrating one implementation attempt and a separate review or verification attempt on the same task, including heartbeats, retry, and flush.

Pass when a real CLI report appears in the API and SQLite, including after server downtime and a CLI restart. Replay the same queued item after a lost response and observe no duplicate. Test concurrent report calls, permissions, full disk/outbox, authentication failure, missing sequence data, and restored-database limitations.

Run the CLI through subprocess integration tests and an interactive terminal walkthrough. Preserve actual exit codes. Measure flush throughput under the P07 fixture. The CLI must not require an installed provider-specific agent or access to private Codex/Claude storage.

## P07. Verify the Phase 2 integration checkpoint

Depends on P05 and P06. Proposed files include release walkthroughs, load scenarios, backup/recovery documentation, and focused fixes supported by failing evidence.

- [ ] On a fresh data directory, create a project/task/agent, register an implementation run, report start/progress/success, inspect Review, record acceptance, and reopen.
- [ ] Repeat with failure, staleness, duplicate reporting, downtime, and reconnect. Verify both browser tabs and persistent history.
- [ ] Check unauthenticated reads/SSE, cross-origin mutation, spoofed Host, oversized payloads, invalid links, and non-loopback access.
- [ ] Verify migration failure recovery, backup restoration, generation reset, permissions, and the documented outbox recovery limits.
- [ ] Run the load scenario below and inspect resource cleanup.
- [ ] Run the execution policy's isolated-install walkthrough, keyboard journey, production build, full relevant tests, lint, and type checking.
- [ ] Verify the approved MIT license and notices, set package license metadata, and record the tested macOS configuration and exact dependency versions.
- [ ] Obtain independent review at the checkpoint commit, including browser journey evidence, and integrate it. Continue to W01; P07 does not publish a release.

## Phase 3 work packages

The [Phase 3 contract](docs/V1_WORKFLOWS.md) owns additive domain/API and interface
choices. Update backend/API/OpenAPI documentation with each implementation so
planned and executable contracts stay aligned. All scopes below are required.

### W01. Observe a reported workflow

Depends on P07. Proposed files: `src/workflows/`, `src/db/schema/workflows.ts`,
`src/app/api/v1/workflows/`, `src/app/projects/[projectId]/workflows/`,
`src/components/workflows/`, and workflow CLI/reporting integration tests.

- [ ] Define immutable plan revisions, workflow attempts, reported nodes/links,
  sequence/idempotency rules, and optional skill provenance as specified.
- [ ] Implement real ingestion/storage/CLI paths before the read-only graph/list.
- [ ] Add project Work board / Workflows navigation and node-to-evidence detail.
- [ ] Test missing reports, duplicates, gaps, cross-project references, plan revision
  changes, stale reports, and offline reconnect against real persistence.
- [ ] Verify keyboard node selection, list parity, reduced motion, 375 px and 200%
  zoom, with screenshots and actual producer-to-visible evidence.

Pass when a synthetic external producer reports a branching workflow through the
public contract, both browser sessions agree, and missing observations remain
unknown. Nodes open the correct task/attempt; the graph cannot launch agents.

### W02. Track dependencies, reviews, and rework

Depends on W01. Proposed files: `src/workflows/dependencies.ts`,
`src/workflows/reviews.ts`, additive schema/migrations and API commands, workflow
readiness/evidence components, and domain/database/browser tests.

- [ ] Enforce same-project acyclic dependencies transactionally, including
  concurrent edge changes and the contract's run-registration readiness gate.
- [ ] Bind reported review decisions to current work revision, artifact identifier,
  and rework round; surface obsolete evidence after revision changes.
- [ ] Explain blockers/readiness in graph and list; preserve human-only completion.
- [ ] Prove a failed review → new work → new artifact → fresh review → human
  acceptance cycle, including stale approval and concurrent-write rejection.

Pass when dependency and review state survives restart/replay and no old approval
or agent report can complete new work. Gating a record never claims to prevent or
cancel execution in the external harness.

### W03a. Observe GitHub PR metadata

Depends on W02. Proposed files: `src/integrations/github/`, local credential
handling, integration settings, PR-detail components, and adapter contract tests.

- [ ] Implement opt-in read-only access scoped to operator-selected repositories.
  Verify current official API/permission requirements before pinning the adapter.
- [ ] Record source/update time, stale/offline state, disconnect, authentication
  recovery, rate limiting, and missing/deleted PR behavior.
- [ ] Test adapter boundaries using a deterministic local server and a real read-only
  smoke check when an authorized repository/credential is available.

Pass when supported PR metadata refreshes without remote mutations, credentials
stay out of source/logs/exports, and offline use retains labeled prior observations.
A missing live credential is disclosed; it cannot waive implemented adapter tests
or be represented as successful live GitHub verification.

### W03b. Export and retain history deliberately

Depends on W03a. Proposed files: `src/history/`, export/retention API commands,
settings panels, migrations, and snapshot/restore/cursor regression tests.

- [ ] Implement versioned export with explicit content selection and no credentials.
- [ ] Implement the contract's default-retain-all policy, preview and explicit
  human prune action, backup/recovery, and protected-record constraints.
- [ ] Prove cursor/generation recovery, retry safety, multi-tab refresh, and
  retention behavior with active attempts and current acceptance evidence.

Pass when export counts match the snapshot, pruning cannot remove protected facts,
and stale clients/outboxes recover without duplicate mutations or silent loss.
Run destructive scenarios only in synthetic isolated test directories.

### W03c. Show reported usage honestly

Depends on W03b. Proposed files: `src/usage/`, report/query schemas, usage view,
price-snapshot handling, and aggregation/replay/timezone tests.

- [ ] Implement explicit usage reporting, bounded snapshot summaries, filters,
  coverage labels, and optional estimates under the Phase 3 contract.
- [ ] Preserve unknown values and source/model/time provenance; deduplicate retries.
- [ ] Test absent/partial usage, mixed models/currencies, rework, outbox replay,
  timezone boundaries, and retention/export reconciliation.

Pass when repeated reports never inflate totals, missing data is never zero, and
an estimate displays its price snapshot, currency, scope, and uncertainty. No
credentials or unrequested outbound pricing service is required for local use.

## W04. Validate and release the complete v1

Depends on W03c and every prior package gate. Proposed files include release
walkthroughs, production load fixtures, upgrade/recovery scenarios, and release
notes; runtime fixes require focused regression evidence.

- [ ] Run the full P07 suite again on the integrated v1 production build, using a
  fresh checkout and isolated data/outbox directories on the named macOS host.
- [ ] Upgrade a Phase 2 fixture through every Phase 3 migration; prove failed
  migration recovery, backup restore, generation renewal, and old outbox handling.
- [ ] Complete the roadmap's branching/rework journey through real HTTP/CLI,
  SQLite, graph/list, and two browser sessions with synthetic evidence.
- [ ] Verify opt-in integration disconnect/offline behavior, exports, protected
  retention, usage reconciliation, keyboard navigation, zoom, and narrow layout.
- [ ] Retain P07 performance budgets; additionally test 100 workflows of 100 nodes
  each, opening a 100-node graph with 200 edges and its equivalent list. On the
  named host, target snapshot p95 <250 ms and report-to-visible p95 <2 seconds.
  Measure at least three runs; record graph interaction stalls and resource cleanup.
- [ ] Obtain independent review at the exact release commit. Record all package
  PRs, SHAs, commands, actual results, screenshots, and limitations in the ledger.
- [ ] Under activated policy, integrate passing packages, set version `1.0.0`,
  create `v1.0.0`, and publish the GitHub source release. Preserve existing tags
  and branch protections. Verify the release points to the reviewed commit.

Completion requires all gates above. A demo, mocked integration, or unchecked
package cannot count as v1. Missing live optional-service evidence must be named
in release limitations without misrepresenting fixture coverage as a live test.

## Performance acceptance targets

These are proposed budgets, not measured results. Adjust only through a recorded decision with measurements and user impact.

Use a named machine, production build, 1,000 tasks, 10,000 stored run events, 10 producers on distinct tasks, and two browser tabs. Run 20 new events/second for five minutes, then a 100-event/second burst for ten seconds. Respect configured rate limits and record any expected `429` responses separately from accepted events. Producers emit valid ordered lifecycles.

- [ ] Accepted-event HTTP latency is below 250 ms at p95 under sustained load.
- [ ] Report-to-visible latency is below two seconds at p95 while connected.
- [ ] Board snapshot latency is below 250 ms at p95 for the stated fixture and bounded page size.
- [ ] A disconnected producer flushes 1,000 queued reports without loss or duplication within two minutes on loopback.
- [ ] After 100 connect/disconnect cycles, open-stream count returns to baseline and heap use returns within 20% after the same controlled collection procedure.

Collect at least three interleaved base/head runs for changed operations and retain raw samples. A greater than 20% p95 regression requires explanation and approval even if an absolute budget passes. Where base lacks a feature, report that fact and use its absolute budget; do not invent a relative speedup. The load targets do not promise support for arbitrary transcript volume.

## Evidence and completion

Unit tests cover transitions and validation. Integration tests cover the actual HTTP/database/CLI boundaries. Browser tests cover visible state and input. Screenshots prove appearance, not persistence. Performance samples prove only the stated workload and machine.

For each PR, record the head SHA, test commands/results, scenario logs, screenshots where UI changes, source of synthetic data, and known limitations. Store runtime evidence outside the tracked data directory and upload only synthetic, redacted artifacts. Keep provider credentials, real repository paths, prompts, and private task text out of public PRs.

Completion of this plan requires P01–P07, W01–W02, W03a–W03c, and W04 gates to pass. The P01 receipt records foundation verification; later package gates have not run.
