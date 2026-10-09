# AgentFlow v0.1 execution policy

Status: approved by the operator on 2026-10-09.
Approval source: the operator selected "Approve the full policy (Recommended)"
in the consolidated policy question in this chat.
This records authorization, not evidence that implementation has passed.

## Approval package

The following decisions are approved together for a future implementation run.
This policy replaces the per-package operator gates in PLAN.md within this scope.
Saving this policy does not start implementation; a subsequent implementation
request activates the approved authority.

1. **Scope and design.** Approve P01-P07 for v0.1 and the existing product,
   design, architecture, backend, frontend, API, and implementation documents,
   with the clarifications below. Accept ADR-004 through ADR-007 as implementation
   decisions. Phase 3, process controls, LAN access, and cloud deployment remain
   separate work.
2. **Delivery.** Permit the coordinator to create isolated worktrees and
   `codex/` branches, install project dependencies and test browsers, implement,
   test, commit, push, create package PRs, and merge those PRs into `main` after
   the package's automated gates pass and an independent reviewer has no
   unresolved blocking findings. Respect branch protections and required checks.
   Use merge commits to retain the detailed Conventional Commits. Integrate
   dependency packages before downstream work; coordinate independent packages
   as PLAN.md permits. The implementation run owns scoped documentation updates.
3. **Review.** Replace per-package and final operator browser sign-off with
   automated browser journeys, screenshots/recordings, accessibility checks,
   and independent agent review of the exact candidate commit. The coordinator
   verifies evidence independently. This waives product-delivery operator review;
   it does not allow reporter credentials to complete real user tasks or permit
   an agent to describe synthetic acceptance fixtures as human attestations.
4. **License.** Adopt MIT for AgentFlow-owned material, with copyright
   `2026 AlesSystems`. The root LICENSE records this decision; set future package
   metadata to `MIT` and retain all
   applicable dependency licenses and notices. MIT permits commercial reuse
   and redistribution subject to its notice requirement.
   [MIT reference](https://choosealicense.com/licenses/mit/).
5. **Installation evidence.** Replace the fresh-operating-system requirement
   with a fresh checkout on the named macOS host, dependency installation from
   the committed lockfile without pre-existing node_modules or build output,
   and isolated data/outbox directories. Verify production launch, recovery,
   and offline browser use there. Report the macOS version, architecture,
   Node version, prerequisites, and commands. This qualifies the tested host
   configuration; it does not claim a pristine-OS or Linux validation.
6. **Implementation discretion.** Let P01 select and pin exact compatible
   dependency/runtime versions. Let P03 resolve design tokens and dimensions
   within DESIGN.md. Resolve routine implementation details with documented
   choices and tests. Preserve SQLite, the observer boundary, local authentication,
   human-only task completion, event ordering, and the stated performance gates.
   Material departures from these constraints require a new decision.
7. **Reporting contract.** Approve running-only heartbeats with queued-run
   staleness as specified in BACKEND.md, and CLI exit code 3 for delivery blocked
   pending operator repair as specified in API.md. Those documents own the
   detailed contracts. Prove these behaviors through integration tests.
8. **Harness integration.** P06 includes an executable external producer
   walkthrough using public CLI/API contracts, heartbeats, retry, and flush.
   Provider-specific automatic adapters remain deferred. The external harness
   owns execution and scheduling; AgentFlow remains an observer.
9. **Release.** After all amended P01-P07 gates and independent release review
   pass at the integrated commit, permit a `v0.1.0` tag and GitHub source release
   with verified setup instructions, evidence, and limitations. An existing tag
   or release must be inspected and preserved rather than overwritten. Hosted
   deployment, npm publication, and installer distribution remain outside scope.

## Execution and stopping

Use relevant available skills and bounded workers, with one independent reviewer.
Prefer named `worker` and `reviewer` roles. Workers use `gpt-6.1-sol` with low
reasoning; reviewers use `gpt-6.1-sol` with high reasoning unless the operator
requests otherwise. When overrides require a no-history fork, supply the complete
bounded task context. Preserve user work and
give concurrent writers isolated worktrees and test data directories. Keep a
durable package/evidence ledger so execution can resume after interruption.

Repair ordinary test, build, and review failures within scope. Stop dependent work
when P01 cannot prove the runtime. Ask only for a missing external capability,
an unresolved material product/security decision, a required protection gate,
or a departure from the approved scope or acceptance budgets. Approval authorizes
work; it does not turn a failed or unavailable check into passing evidence.

Completion means the amended P01-P07 gates pass, package changes are integrated,
and the source release points to the reviewed commit. Otherwise record the exact
remaining gate and current commit; keep incomplete packages open.

## Starting the future run

The operator can activate this policy with:

> Implement AgentFlow v0.1 P01-P07 using PLAN.md and the approved
> docs/EXECUTION_POLICY.md. Use relevant skills, bounded workers, and independent
> review. Continue through verified package integration and the v0.1.0 source
> release under the saved authority. Keep a durable progress and evidence ledger;
> ask only at the stopping conditions defined in the policy.
