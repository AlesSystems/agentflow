# AgentFlow v1 execution policy

Status: the operator activated the complete v1 implementation run on 2026-10-09,
including scoped installation, worktrees, commits/pushes, package PRs, verified
merges, and the final source release. P01 is in implementation; no package is
complete until its exact candidate passes independent review and integration.
The earlier P01–P07 controls and expanded v1 scope below govern this active run.

## Scope and activation

The operator now wants all three phases completed in order for v1. This supersedes
the old v0.1 release boundary. The operator used the activation contract for this implementation run. Recording
or merging the policy alone would not have supplied that authority.

1. **Scope and design.** Implement P01–P07, W01–W02, W03a–W03c, and W04 in
   [PLAN.md](../PLAN.md), with [V1_WORKFLOWS.md](V1_WORKFLOWS.md) for the new
   contracts and the selected Work board/graph design. Complete Phase 1, then
   Phase 2, then Phase 3, then final validation. P07 is a checkpoint, not a
   v0.1 release. Agent controls, LAN access, multiple users, cloud deployment,
   npm publication, and installer distribution remain outside this run.
2. **Delivery.** Permit the coordinator to create isolated worktrees and
   `codex/` branches, install project dependencies and test browsers, implement,
   test, commit, push, create package PRs, and merge those PRs into `main` after
   the package's automated gates pass and an independent reviewer has no
   unresolved blocking findings. Respect branch protections and required checks.
   Use merge commits to retain the detailed Conventional Commits. Integrate
   dependency packages before downstream work; keep packages sequential and delegate
   independent tasks within the current package only. The implementation run owns scoped documentation updates.
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
9. **Release.** After all v1 package gates and independent release review
   pass at the integrated commit, permit a `v1.0.0` tag and GitHub source release
   with verified setup instructions, evidence, and limitations. An existing tag
   or release must be inspected and preserved rather than overwritten. Hosted
   deployment, npm publication, and installer distribution remain outside scope.

## Execution and stopping

The coordinator may delegate bounded implementation and review tasks using the
available harness tools. Workers use `gpt-6.1-sol` with low reasoning; reviewers
use `gpt-6.1-sol` with high reasoning, preferably named roles. Supply complete
scope, dependencies, write boundaries, acceptance gates, and return evidence to
fresh workers. Every package also requires an approved Astra medium implementation plan before
its worker starts. P01 received that gate for the exact plan recorded in
[the P01 receipt](implementation/P01.md). A reviewer is independent of the implementation it reviews. The
coordinator verifies returned evidence and owns integration.

Use Poteto and Impeccable where applicable, plus relevant planning, testing,
review, and security skills. Read each skill before use. Available tools decide
execution mechanisms; a skill is never evidence that an unavailable tool ran.
Keep a durable [delivery ledger](DELIVERY.md) updated after each gate and before
handoff. Resume from the verified commit and next incomplete gate, not from memory.

Repair routine build/test/review failures autonomously within scope. After two
unsuccessful attempts on the same failure, diagnose and change approach before
retrying; do not keep repeating the same action. If no safe route remains, record
the exact blocker and stop dependent work. Work may continue on independent tasks
inside the current package; never mark an unavailable check passed.

Ask only for unavailable credentials/external capabilities, required branch
protection or account approval, a material product/security decision the plan
does not settle, or a departure from the agreed scope/budgets. A one-prompt run
removes routine phase handoffs; it cannot guarantee uninterrupted execution when
external access, platform limits, or new material decisions intervene. It does
not schedule background continuation or bypass the harness's limits.

GitHub integration is disabled by default. Test its full adapter with deterministic
fixtures without touching the operator's real repos. Enabling live synchronization
requires the operator's selected repositories and appropriately scoped existing
credentials; no prompt authorizes unbounded account access. Never publish secrets
or private task data. Retention tests use synthetic directories; the implementation
run does not authorize pruning the operator's real history.

Completion means all P01–P07, W01–W02, W03a–W03c, and W04 gates pass, package changes
are integrated, and the source release points to the independently reviewed commit.
Otherwise record the remaining gate and current SHA, leaving its checkbox open.
Fixture evidence can prove adapter behavior; absent live optional-service evidence
must remain an explicit release limitation. Core local operation and generic
producer integration require actual end-to-end proof.

## Starting the future run

The operator can issue this single prompt when ready to implement:

> Implement AgentFlow v1 from PLAN.md, ROADMAP.md, docs/V1_WORKFLOWS.md, DESIGN.md,
> and docs/EXECUTION_POLICY.md. I activate the v1 execution policy for this run,
> including scoped dependency installation, isolated worktrees, commits, pushes,
> package PRs, verified merges, and the final v1.0.0 GitHub source release.
> Complete Phase 1 P01–P03, then Phase 2 P04–P07, then Phase 3 W01, W02, W03a,
> W03b, W03c, and finally W04. Use relevant skills, bounded implementation workers,
> and independent reviewers; keep the selected playful Work board design and
> include the connected workflow graph. Respect protections and require each
> package's checks and review to pass before integrating and continuing. If the
> planning PR is still open, verify and integrate it first under the same rules.
> Keep AgentFlow an observer of agents started externally, and preserve human-only
> task acceptance. Maintain docs/DELIVERY.md with exact commits, commands, results,
> review evidence, limitations, and the next incomplete gate. Repair ordinary
> failures and continue without asking me at each phase. Ask only at the stopping
> conditions in the policy. Do not call the job complete until every v1 gate passes
> and the reviewed source release is verified; otherwise report the precise blocker.
