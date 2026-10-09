# AgentFlow v1 delivery ledger

Status: three packages passed acceptance, independent review, coordinator verification
and integration. [PR #4](https://github.com/AlesSystems/agentflow/pull/4) integrated
P01 at `a2e5170879602faff706e1aa2e5e7a1905d63b47`.
[PR #5](https://github.com/AlesSystems/agentflow/pull/5) integrated P02 at
`f0b3cf2b6588d7d5028757e4ad316b74dff6eb3c`. [PR #6](https://github.com/AlesSystems/agentflow/pull/6) integrated P03 at
`cf44dd9103c091c10c9608468e5956e506c6705c`. P04 planning requires Astra medium approval before implementation; P05 through W04 have not started.

## Package state

Advance sequentially. A package is complete only after its acceptance gate,
independent review of the candidate SHA, and verified integration all pass.

| Package | Deliverable | State | Candidate / integrated SHA | Evidence |
| --- | --- | --- | --- | --- |
| P01 | Runtime/storage | Integrated | Candidate `8e0e0c78f1c6579b3f2aed4dfbc065e1ca92a59b`; merge `a2e5170879602faff706e1aa2e5e7a1905d63b47`, PR #4 | [Receipt](implementation/P01.md), [synthetic evidence](evidence/P01/acceptance.json) |
| P02 | Task contracts | Integrated | Candidate `6cdf65da4a6ef73ff28b267492b2a993a6729a47`; merge `f0b3cf2b6588d7d5028757e4ad316b74dff6eb3c`, PR #5 | [Receipt](implementation/P02.md) |
| P03 | Work board | Integrated | Candidate `8847228f0fc1612c5fb0dbfabe56278cb56365c6`; merge `cf44dd9103c091c10c9608468e5956e506c6705c`, PR #6 | [Receipt](implementation/P03.md), [verification](evidence/P03/verification.json) |
| P04 | Agent ingestion | Planning | Baseline `cf44dd9103c091c10c9608468e5956e506c6705c`; branch `codex/v1-p04-observations` | Astra plan approval pending |
| P05 | Live tracking | Not started | — | — |
| P06 | CLI hooks | Not started | — | — |
| P07 | Phase 2 checkpoint | Not started | — | — |
| W01 | Reported workflow graph | Not started | — | — |
| W02 | Dependencies/review/rework | Not started | — | — |
| W03a | GitHub PR observation | Not started | — | — |
| W03b | Export/retention | Not started | — | — |
| W03c | Usage summaries | Not started | — | — |
| W04 | Full v1 validation/release | Not started | — | — |

## Record after every package or interruption

- Package, branch/worktree, PR URL, candidate SHA, and integrated SHA if any.
- Accepted input contracts and exact changed paths; worker ownership boundaries.
- Commands, actual results, host/runtime versions, and paths to synthetic evidence.
- Independent reviewer findings and resolution at the current SHA.
- Missing checks, live-service limitations, blockers, and retained local work.
- The next executable action and gate. Do not mark a phase complete by inference.

Keep secrets, real prompts/task data, private repository identifiers, and runtime
databases out of this public ledger. Store redacted or synthetic evidence only.

## Resume procedure

1. Read AGENTS.md, PLAN.md, EXECUTION_POLICY.md, this ledger, and the current
   package's contracts. Confirm the operator activated implementation authority.
2. Inspect Git/worktree/PR state and verify recorded SHAs. Preserve unrelated work.
3. Reuse valid evidence tied to unchanged code. Rerun checks whose inputs changed
   or whose result cannot be established; do not restart completed packages.
4. Continue at the earliest incomplete gate. If a protection or capability blocks
   it, record that fact and request only the missing input.

Final receipt must name `v1.0.0`, the reviewed release SHA, every package PR,
installation instructions, actual checks, and remaining limitations. Until then,
report progress precisely; a partial demo or documentation PR is not v1 completion.

## Current P01 handoff

Branch `codex/v1-p01-runtime`; baseline `e4d7b84`. The approved Astra medium
plan hash is `07278b67c601f931b2972f86566fec3c388db4b1aa85eb34b310105de8f3d912`.
Source proof is tied to `af3cc1d2356492a502df68edd958768202004d0c`; the final
receipt commit changes only docs/evidence. Small commits preserve regression
red/green loops; no reset, rebase, force push, PR or merge was performed by the
writer. The coordinator owns independent review, PR creation and integration.

The clean-private installation baseline and final-source replay passed dependency-tree validation,
lint, types, production build, 10 unit tests, 47 integration tests, 3 Chrome
browser journeys and listener/HTTP/integrity/resource checks. The focused runtime
suite passed 28 tests. Production audit has zero findings; two dev-tool advisory
chains remain explicitly qualified in the receipt. Browser default Chromium
installation was cancelled after slow download; installed Chrome 154 was tested
in temporary profiles. Native use is the bundled darwin-arm64 prebuild, not a
claimed source compilation.

See the receipt and acceptance JSON for exact build identities, lock hash,
readiness/RSS samples, screenshots, historical failed checks and limitations.
Owned test servers and the incomplete browser download were stopped. Fixture
clones and synthetic data are retained for review; no operator data was used.

Integration verified by the coordinator. Standards and Spec reviewers approved
exact candidate `8e0e0c78f1c6579b3f2aed4dfbc065e1ca92a59b`; scoped Impeccable review
scored the disconnect fix resolved at unchanged UI source `68c64dd`. The coordinator
reran 28 production runtime and 9 private-path tests, all passed, then verified
PR #4's merged state and candidate ancestry on main. No required GitHub checks
were configured; no protection bypass was used.

Next action: finish the P03 plan, obtain Astra medium approval, implement the
selected Work board, then review its exact candidate and browser evidence.

The P1 application-contained data exposure was repaired under supplemental Astra
medium plan approval `a4589e4f768f79bc9062e3d343a82fabbc980d67ddaac2c92426a1c56ccbeb3c`.
Active-root containment now precedes writes for runtime, maintenance, candidate
and backup destinations. Final source `af3cc1d` was rebuilt and fully replayed in
the same-lockfile clean-private clone, reusing its documented fresh install at
`ebc2391`. Updated evidence is 10 unit / 47 integration / 3 browser tests;
published UI captures and the scoped UI verdict are unchanged. Independent final
code review and integration passed; P01 checkboxes are complete and later package
checkboxes remain open.


## Current P02 handoff

Implementation candidate `71bc5a51f1522dbcc06c093dad1d31ba1aab568e` on
`codex/v1-p02-contracts` extends integrated P01 receipt base
`fb507181b13999dea46acfde08f07bb9dbb4847d`. Astra medium approved plan
`9ed89f3489762f8e23bed29b426f953eb5c56956593c8c45f7fcc6ee07cea451`.
P02 subsequently passed independent exact-candidate review and integration. Its
PLAN boxes are complete; the verified integration receipt below owns the result.
No worker push, PR or merge occurred. The final handoff commit is docs/evidence only.

Unchanged source passed 24 unit, 63 integration and 3 retained P01 Chrome browser
tests, lint, types, production build and OpenAPI reproducibility/example checking.
Three production runs with 1,000 tasks, 200 runs, 300 comments and 100 synthetic
completions measured task/board/overview p95 below 2.46 ms and the 250 ms budget.
Production audit is clean; the two known development advisory chains remain.
[P02 receipt](implementation/P02.md) and [structured proof](evidence/P02/verification.json)
record exact source, lock hash, host, commands, redacted HTTP/restore evidence,
performance distributions, historical failures and qualifications.

Next gate: independently review `71bc5a5` source and this docs-only receipt, repair
blocking findings within P02, reverify the affected candidate, then publish and
integrate one scoped P02 PR. P03 starts only after verified P02 integration.


### P02 repaired candidate handoff

Repaired source `baf0bffcf79baf6268133fc3c8b1dd20b2ab967b` supersedes the original
`71bc5a5` candidate. It preserves allowed reporter bearer Origins, mirrors all ten
missing Drizzle CHECKs without migration edits, and fixes cleanup of already
SIGKILL-exited test children. Executed failing regressions precede these fixes.
Final unchanged candidate passed 25 unit, 65 integration and 3 Chrome journeys,
lint, types, build and OpenAPI checks. Raw final repair logs remain ignored under
`work/poteto/P02/repair-final-*.log`. The original pass did not prove reliable
already-exited fixture cleanup; the repaired suite now pins it explicitly.

Runtime-identical performance/capture evidence at `9735ea7` is retained with its
actual provenance; the later delta affects only test cleanup and its regression.
The three production snapshot runs remain below 2.83 ms p95 and the 250 ms budget.
Astra approved bounded P02 rowid ordering with the mandatory explicit durable
P04 registration-order prerequisite now recorded as an unchecked PLAN item and
in BACKEND/DECISIONS. No P04 code was added. P02 still awaits final independent
exact-candidate review, CI and integration; no worker publication or merge occurred.

## Verified P02 integration

Independent Standards and Spec reviewers approved exact final candidate
`6cdf65da4a6ef73ff28b267492b2a993a6729a47`. The coordinator replayed 13 focused
HTTP/storage/query/schema/crash-helper tests and OpenAPI verification, checked the
unchanged patch and current PR head, merged PR #5 with the match-head guard, and
verified the candidate is on main at `f0b3cf2b6588d7d5028757e4ad316b74dff6eb3c`.
No required GitHub checks were configured and no protections were bypassed.
The merged branch was removed. The mandatory durable registration-order condition
remains unchecked in P04; P03 does not expose agent reporting. Next gate is P03
Astra plan approval, followed by the selected UI and real browser acceptance.

## Current P03 handoff

Astra medium approved plan SHA-256 `e555bef620bb0d5bc588f44820f1791edb73605a92af84f4816b832f61c301af`. The selected Work board now implements persistent manual task operations, recovery, keyboard movement and pointer lane drops. Independent review found draft loss, retained old snapshot pages, overlapping Overview continuations and lost filter return context; focused regressions and repairs are committed. Direct-route heading focus also received an explicit regression/fix. [P03 receipt](implementation/P03.md) records source identities, actual commands and synthetic visual evidence. Final exact-candidate review, PR publication and verified integration remain open; no P03 checkbox is complete yet.

## Verified P03 integration

Both independent code axes approved exact candidate `8847228f0fc1612c5fb0dbfabe56278cb56365c6`. The coordinator replayed nine focused contract/HTTP tests, 28 final unit tests and six final production-browser regressions, verified source hashes and the current PR head/base/patch, and merged PR #6 with the match-head guard. Candidate ancestry on main is verified at `cf44dd9103c091c10c9608468e5956e506c6705c`. All P03 boxes are complete. The owned branch was removed without force deletion, and the primary checkout fast-forwarded cleanly.

Next executable gate: plan P04 and obtain Astra medium approval before the first public agent/run registration. Include the mandatory additive immutable registration-order migration, high-water allocation and both latest-query durability tests. P05 through W04 remain open.
