# AgentFlow v1 delivery ledger

Status: P01–P07, W01, W02, and W03a passed acceptance, independent review, coordinator verification
and integration. [PR #4](https://github.com/AlesSystems/agentflow/pull/4) integrated
P01 at `a2e5170879602faff706e1aa2e5e7a1905d63b47`.
[PR #5](https://github.com/AlesSystems/agentflow/pull/5) integrated P02 at
`f0b3cf2b6588d7d5028757e4ad316b74dff6eb3c`. [PR #6](https://github.com/AlesSystems/agentflow/pull/6) integrated P03 at
`cf44dd9103c091c10c9608468e5956e506c6705c`. [PR #7](https://github.com/AlesSystems/agentflow/pull/7) integrated P04 at `d84a455ff167ecfdc7ef1afc1c6e4a1983cae1fe`. [PR #8](https://github.com/AlesSystems/agentflow/pull/8) integrated P05 at `787865132d89a9b03f613942f64945887bc13f95`. [PR #9](https://github.com/AlesSystems/agentflow/pull/9) integrated P06 at `36f6d1bc4699c706e3f57a17cfcc85a1576c648b`. [PR #10](https://github.com/AlesSystems/agentflow/pull/10) integrated P07 at `dd26c4b00867e7680c3baf0cf2be39b60502aecf`. [PR #11](https://github.com/AlesSystems/agentflow/pull/11) integrated W01 at `e5bf6da0e22a64b40fc5817fb1d3a4d237bdb168`. [PR #12](https://github.com/AlesSystems/agentflow/pull/12) integrated W02 at `1ce0c52ab9fedab0b8a61eb8c15131c2d8e69361`; guarded cleanup is complete. W03a implementation and qualified verification are accepted, including its exact scoped performance exception. PR #13 integrated W03a at `76fe748a3d642f8a5a6ea738af47a3bb640070d3`; private archival and guarded cleanup are complete. W03b has exact-plan approval and accepted Tasks 1–4. Task 5 executable qualification remains open; W03c and W04 remain unstarted.

## Package state

Advance sequentially. A package is complete only after its acceptance gate,
independent review of the candidate SHA, and verified integration all pass.

| Package | Deliverable | State | Candidate / integrated SHA | Evidence |
| --- | --- | --- | --- | --- |
| P01 | Runtime/storage | Integrated | Candidate `8e0e0c78f1c6579b3f2aed4dfbc065e1ca92a59b`; merge `a2e5170879602faff706e1aa2e5e7a1905d63b47`, PR #4 | [Receipt](implementation/P01.md), [synthetic evidence](evidence/P01/acceptance.json) |
| P02 | Task contracts | Integrated | Candidate `6cdf65da4a6ef73ff28b267492b2a993a6729a47`; merge `f0b3cf2b6588d7d5028757e4ad316b74dff6eb3c`, PR #5 | [Receipt](implementation/P02.md) |
| P03 | Work board | Integrated | Candidate `8847228f0fc1612c5fb0dbfabe56278cb56365c6`; merge `cf44dd9103c091c10c9608468e5956e506c6705c`, PR #6 | [Receipt](implementation/P03.md), [verification](evidence/P03/verification.json) |
| P04 | Agent ingestion | Integrated | Candidate `9887c4124277269d24329d51f2b0ff3b197ff278`; merge `d84a455ff167ecfdc7ef1afc1c6e4a1983cae1fe`, PR #7 | [Receipt](implementation/P04.md), [verification](evidence/P04/verification.json) |
| P05 | Live tracking | Integrated | Candidate `aa28e949ba0d7147fec2e481ec37423521dbe570`; merge `787865132d89a9b03f613942f64945887bc13f95`, PR #8 | [Receipt](implementation/P05.md), [summary](evidence/P05/summary.json) |
| P06 | CLI hooks | Integrated | Candidate `e568f6fe84cc3c62ebb26dbb22092673d23f07ce`; merge `36f6d1bc4699c706e3f57a17cfcc85a1576c648b`, PR #9 | [Receipt](implementation/P06.md), [synthetic evidence](implementation/evidence/P06/README.md), [integration](#verified-p06-integration) |
| P07 | Phase 2 checkpoint | Integrated | Candidate `b680468166d7716008d433ba6c8d6a12ee4a9838`; merge `dd26c4b00867e7680c3baf0cf2be39b60502aecf`, PR #10 | [Receipt](implementation/P07.md), [synthetic evidence](evidence/P07/acceptance.json) |
| W01 | Reported workflow graph | Integrated | Reviewed `4e527a4b1fc31200eeda45a72a67d214b4b064ea`; merge `e5bf6da0e22a64b40fc5817fb1d3a4d237bdb168`, PR #11 | [Receipt](implementation/W01.md), [synthetic summary](evidence/W01/acceptance.json) |
| W02 | Dependencies/review/rework | Integrated | Reviewed `cc3344bcf2fd210ae1536c28f73f508c0e6a6c37`; merge `1ce0c52ab9fedab0b8a61eb8c15131c2d8e69361`, PR #12; executable `8b76bed` | [Receipt](implementation/W02.md), [synthetic summary](evidence/W02/acceptance.json) |
| W03a | GitHub PR observation | Integrated; guarded cleanup complete; qualified measured exception retained | Reviewed `8f63d231ff63d8b77c51573fad9790be8ac78c9d`; merge `76fe748a3d642f8a5a6ea738af47a3bb640070d3`, PR #13; executable `1931221` | [Receipt](implementation/W03a.md), [allowlisted evidence](evidence/W03a/acceptance.json) |
| W03b | Export/retention | Tasks 1–4 accepted; executable qualification, quiet measurement, final review, and integration open | Task 4 `e958a1128b204bac978f212466129f411dd7386e` | [Initial receipt](implementation/W03b.md) |
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

## Current P04 handoff

Astra medium approved plan SHA-256 `27dd58db2397bcd5a3999897b303fb5463afea7365cee500905e88fb7a9ef77a`. The independent migration gate approved `bfba1c54e715b1528b1c56ed9b1bb9940377a700` before public implementation. Reviewed runtime `1cb71db033aabec211afd6ce86728a33561f1974` passed 60 unit, 164 integration and 22 Chrome tests, lint/types/build/OpenAPI. Root replayed 88 migration checks and 34 final identity/helper tests, checked 39 source hashes, independent retained database facts, and the final evidence. Three 1,000-sample runs and sustained/burst load pass the 250 ms ingest budget; worst native snapshot regression 9.12%. Synthetic fixture cleanup is complete. Final documentation/evidence SHA approval and PR integration remain open; all P04 boxes stay unchecked until verified merge. P05 through W04 remain unstarted.

## Verified P04 integration

Both review axes approved exact candidate `9887c4124277269d24329d51f2b0ff3b197ff278`; Root independently verified runtime hashes, focused tests, retained DB facts/cleanup and the current head/base/patch. PR #7 merged with the match-head guard and candidate ancestry is verified at `d84a455ff167ecfdc7ef1afc1c6e4a1983cae1fe`. Main had no required checks; no bypass was used. Historical migrations are frozen, and P04 boxes are complete. The primary checkout is clean and the owned merged branch is removed.

Next executable gate: plan P05 live replay/recovery and the selected Agents/Activity UI, obtain Astra medium approval, then implement under bounded Impeccable review and truthful reporting/connection-state contracts. P06 through W04 remain open.

## Current P05 verification checkpoint

Astra medium approved plan SHA-256
`e70c35a7431cad373eb11c7987de785307232ca6f486ab2d5afa952013192031`.
The native transport prerequisite received independent approval at `8558427`
before the client/query/UI slice started. Source `279ef6313a7d7cbbd9e0b55ba9323d7a7ca6cdf5`
implements one browser subscription owner, joined tracking snapshots, Agents,
Activity, attempt history and browser-only stale-record closure. Independent
review exposed reconnect/reset cursor failures and closure editor lifetime/identity
failures; focused regressions and repairs precede this source. The scoped finish
review scored accepted long-name wrapping and actual keyboard/focus evidence
resolved. Actual production journeys prove two-tab convergence, silence-driven
staleness, stopped restore/pairing and retained drafts/exact retry identities.

Final source passed 69 unit, 167 integration and 30 Chrome tests, lint, types,
build and OpenAPI verification. Corrected measurement helpers received independent
exact-hash approval before the full/default run. Its 180 matched visible samples
have worst p95 532.411 ms; board p95 2.685 ms; sustained 6,000 accepted in 300.002 s
and burst 1,000 in 10.00198 s, with zero errors/429s. Worst of 15 equivalent native
comparisons is +2.620%. Fixed-dataset 100 cycles return heap within +4.831% and all
tracked stream resources to zero. Renderer heap and paused-reader pressure remain
explicitly qualified in the receipt. Root independently reran 167 integration
tests and recomputed raw protocol/timing/budget/cleanup facts. Public evidence
normalizes private hostname/local paths while retaining original hashes.

Extracted design documentation and qualified visual evidence are complete. Final
exact-candidate code reviews, PR publication and coordinator integration remain
open. All P05 checkboxes stay unchecked until verified merge; P06 through W04
remain unstarted.

## Verified P05 integration

Standards and Spec independently approved exact final candidate
`aa28e949ba0d7147fec2e481ec37423521dbe570`, including the explicit pre-load
visibility scope and metadata-only correction. Root verified current PR head,
base, patch, protections and checks, merged PR #8 with the match-head guard and
verified candidate ancestry at `787865132d89a9b03f613942f64945887bc13f95`.
Main had no required checks or protection bypass. All P05 boxes are complete;
global performance boxes remain open for the combined integration/release gates.
The owned merged branch was removed and the primary checkout fast-forwarded.

Following gate at integration: plan P06 public-HTTP CLI hooks and durable bounded outbox,
obtain Astra medium approval, then implement without provider-specific agent
dependencies. P07 remains a checkpoint with combined-load observer evidence;
W01 through W04 remain open and no release has been published.

## P06 preservation checkpoint

Historical bounded checkpoint. The current gate is recorded in the acceptance checkpoint below.

Astra medium approved implementation plan SHA256
`fc209b31a1d587f3fa1d8952503351b0179ffa8eb8acbb7bbdd02473affc63b1`
before P06 source work. Independent review approved the implemented preservation
boundary and bounded repairs at exact clean source
`66800378ef93e617288408c46125a9b77a3c3816`; review SHA256 is
`99e23bed96794742829f248f143aabf2779d3981f4de67205bf51e43d8d63773`.
This checkpoint does not complete P06 or authorize a release.

The unchanged source passed 153 focused tests in 12 files in 193.66 seconds,
typechecking, scoped lint, and diff checks. Root matched 26 source hashes,
36 proof hashes, and their private archive copies. The independent reviewer
passed 18 selected repair tests, with 39 unselected tests, plus nine native HTTP
semantics cases. Original counterexamples now show no proxy traffic, retained
corrupt temporary files, and prompt FIFO rejection. Registration, concurrent FIFO
reporting, quota-boundary crashes, acknowledgement ordering, filesystem faults,
and retained identity use synthetic subprocess, public HTTP, SQLite, and file
fixtures. Evidence remains private until the package acceptance receipt.

Six valid-content cases exercise actual recovery writes at the logical global
quota with nonempty mutation samples. Separate sparse-file cases establish only
preflight accounting and bounded-artifact rejection. Logical file lengths and
injected failures are distinct from physical disk exhaustion and power loss.
The tests reuse the P05 production application build while executing current CLI
source through pinned tsx; no rebuilt P06 or full-project acceptance is claimed.

The delivery gate is recorded below. Producer and PTY walkthroughs, throughput,
rebuilt production, full regression suites, final cleanup, final Standards and
Spec review, PR publication, and integration remain open. P06 checkboxes stay
unchecked. P07 still owns combined-load observer visibility; later packages have
not started.

## P06 delivery checkpoint

Historical bounded checkpoint. The producer and performance gates described here have since passed; see the acceptance checkpoint below.

Independent review approved the delivery implementation and two bounded repairs
at `09f75b7caa3202bca82388891424e27e5c6c6968`. Review SHA256 is
`e0c1d3661f513dfd69c080505b11732bcf5a8320bb4734a2643c1cb7a73de774`.
The same Astra-approved P06 plan applies. This closes Unit 3; package acceptance
and integration remain open.

The initial delivery candidate passed 229 tests across 26 files in 326.13s,
including affected preservation and existing observation, recovery, authentication,
private-path and administrative CLI cases. Independent review reproduced two
missing contracts: valid large Retry-After values overflowed into short retries,
and per-run remote validation exceptions stopped healthy independent delivery.
Both were pinned with failing real CLI/public HTTP/SQLite tests and repaired.
The final affected combination passed 72 tests across 14 files in 205.17s;
typechecking, scoped lint and diff checks passed. These overlapping counts are
separate checks, not a combined test total or a full-project result.

Independent repair verification passed seven tests across two files and both
original counterexamples with passing repair expectations. Large decimal retry
values now allow one attempt within the invocation window and preserve exact
identity for fresh flush. Actual stopped restore now blocks the mismatched run,
retains its original record and watermarks, delivers the independent run in the
same flush, and returns code 3. Global corruption and filesystem errors remain
fail-closed. The reviewer matched 44 source, 13 proof, 13 private archive and two
receipt hashes. The cached P05 production application build and current CLI via
tsx remain the tested configuration; the P06 production rebuild is still open.

Root preserved source and raw proof, then removed exactly 763 completed original
worker fixture roots after canonical path, UID/device/inode and open-file checks.
Current repair and reviewer fixtures were retained for their later scoped cleanup.
No operator data or unrelated files were removed.

Next gate: executable generic producer and actual PTY exit-code evidence, followed
by reviewed performance helpers and the authorized quiet acceptance runs. Three
1,000-report flush runs, equivalent public HTTP comparison, rebuilt production,
full unit/integration/browser checks, OpenAPI verification, documentation, final
Standards/Spec review and guarded PR merge remain required. P07 combined-load
observer sampling remains a later gate; P06 throughput cannot supply it.

## P06 acceptance checkpoint

Initial full validation checkpoint. The subsequent final-review repair is recorded below.

The original Astra-approved plan and two separately approved performance amendments
govern this candidate. The second amendment plan SHA256 is
`05fe5f6810a18d3d4b445bf588187215912d0dcb617eff40931a9589a985f39a`;
Astra approval SHA256 is
`5c50594516490cb210d6b8ae4667cbceafeb862d5513742fb05375790b5253f3`.
Independent bounded review approved runtime
`4bb6dee4c269f493723c6b684eec1e8606a07528`, passing 13 selected subprocess tests.
This approval does not replace final package Standards and Spec reviews.
The scoped documentation/evidence commit is
`ba67b2ffd6e691b6ba1fb512c2678560d8c15af8`.

[The P06 receipt](implementation/P06.md) records the public-HTTP CLI, private
durable outbox, registration dependencies, fair delivery, crash recovery, restore
limits, and executable external producer. Actual PTY checks prove exits 0/2/1/3.
The fresh two-tab producer journey retains nine exact implementation/verification
events and leaves the task in Review with zero completion records. AgentFlow
continues to observe externally owned execution; no provider-private state or
automatic human acceptance is introduced.

Three fresh 1,000-observation flush trials passed in 98.344, 102.539, and 101.670
seconds, including CLI startup. Setup remains separate. Each outbox finishes at
1,000 allocated/acknowledged observations with zero pending, missing, or duplicate
events. Three native comparisons retain 4,620 requests and 42 distributions:
maximum p95 1.852875ms, worst positive regression 6.2067 percent. Root independently
checked all 3,000 original event identities, payloads, digests, queued byte
descriptors, stored/stdout ACKs and times, watermarks, database counts, integrity
and foreign keys. Root recomputed every distribution and separately checked 330
paired ingestion bodies and 660 stored acknowledgements.

[Synthetic evidence](implementation/evidence/P06/README.md) includes the exact
original compressed receipts for both failed attempts and the passing attempt.
The failed partial datasets are not acceptance runs. Typed API pagination checks
event IDs/counts; full body/digest checks are SQLite/original-queue evidence.
Performance used cached P05 assets with the current CLI; it does not claim a CLI
baseline speedup or combined-load observer visibility.

The separate fresh production build is `sDI0xsv04jaYR13VYrGHA`. On the named macOS
27.0 (26A428) arm64 host with Node v24.15.0/npm 11.12.1, `npm run build`,
`npm run test:unit` (70 tests/17 files), `npm run test:integration` (383 tests/57
files, 498.87s), and `npm run test:e2e` (31 actual Chrome tests) all passed.
Integration/browser commands used `AGENTFLOW_TEST_BROWSER=chrome` and a fresh
private evidence directory. Unit/CLI tests execute current source through pinned
tsx; HTTP/browser fixtures use the new production build. Full lint, type checking,
OpenAPI verification, and diff checks passed. No runtime repair was needed.
These counts are full current suites; earlier overlapping focused counts are not
added to them. The named installed host does not supply P07's fresh-checkout
installation evidence.

Root matched 210 committed/working source, documentation and public-proof hashes,
394 production asset hashes, 20 private proof hashes and the loaded SQLite addon.
Owned synthetic fixtures are inventoried and retained for final review; resources
closed with zero open files. Historical cleanup receipts remain separate. Final
Standards and Spec reviews of the coordinator's candidate, guarded PR creation and
merge, and remaining scoped cleanup are open. P06 boxes remain unchecked until
verified integration. P07 must then receive its own Astra-approved plan, including
combined-load observer sampling and isolated-install evidence. Later packages and
the v1 source release remain open.

## P06 delivery-lock repair checkpoint

Final Standards review approved `341ccda1d7c9e188d997b86cc1618ba4f4c34eca`.
Final Spec review reproduced one P2: delivery acquisition caught native SQLite
I/O errors as contention and returned queued 2 instead of local 1. The controlled
fault retained the event unchanged, made no event POST, and recovered with one
exact event through fresh flush. No actual disk fault or data loss was observed.

Astra medium approved repair plan SHA256
`5ff958f7375a9b45a2618fb654e5377aa6e3bfdd0612ed5c3c7b842c8ee2d53d`;
approval SHA256 is
`df15ff6980d86219712e4bec0c2e50477989d9c20d9dddaf7d8120491234062b`.
RED `6fc92cb` pinned native IOERR and forged nonnative BUSY failures. Fix `154a921`
shares the existing nominal native BUSY/LOCKED predicate and propagates every
other delivery BEGIN error. No successful-send, lock lifetime, cleanup/rollback,
cursor, ACK, quota, HTTP, deadline, schema, dependency or application input changes.
Documentation/evidence candidate is `798bade19f39b9682d838227f892813e02b4d416`.

Ten fresh focused delivery/publication tests passed. Native I/O and forged errors
produce local 1; genuine BUSY/LOCKED and a deterministically held OS lock produce
queued 2. Original record bytes, digest, sequence, watermarks and lock identity
remain intact, with zero associated POST before exact fresh recovery.
One full combined unit/integration execution on fixed source passed **458 tests
in 75 files**, 469.07s: 70 unit/17 files and 388 integration/58 files. Lint, types,
OpenAPI and diff checks passed. The relevant actual Chrome P06 producer journey
passed in 14.2s (15.0s total) using the repaired source CLI and retained production
build `sDI0xsv04jaYR13VYrGHA`. Other 30 Chrome cases and the production build retain
their prior completed executions with unchanged application/browser inputs.

Astra explicitly accepts the prior successful-path performance evidence for this
exception-only repair, conditional on exact final-diff verification and fresh
controls. Measurements remain attributed to `4bb6dee`; they are not new repaired-
source measurements or a waived budget. Root verified the executable delta is
only the private predicate extraction and delivery error propagation, matched
363 committed/working tracked-file hashes, 30 private proof hashes and all 394
retained build asset hashes. [The P06 receipt](implementation/P06.md) preserves
the provenance and original failed/passing raw receipts.

The new validation used an inventoried private temporary parent outside every
checkout, with 52,253 entries and zero observed open files. Its fixtures remain
for final review and enumerated cleanup. Earlier unenumerated RED roots are not
claimed or removed. Source is frozen for independent Spec re-review of the
original counterexample and Standards delta review at the coordinator's final
candidate. Guarded PR/merge, cleanup and P07 remain held; P06 stays unchecked.

## Verified P06 integration

[PR #9](https://github.com/AlesSystems/agentflow/pull/9) merged final candidate
`e568f6fe84cc3c62ebb26dbb22092673d23f07ce` at
`36f6d1bc4699c706e3f57a17cfcc85a1576c648b`, 2026-10-10T10:33:42Z.
Final independent Standards and Spec re-reviews approved that exact candidate,
closing the sole native delivery I/O classification finding. Root read both
reports and independently verified the source, evidence and applicability gates.
Final stable patch ID is `39e385bf38463a4282523578f18b3ad27d0708ba`.

GitHub showed the approved head, unchanged P05 base, clean mergeability, no required
checks, no branch protection and no active branch rules. The verification ledger
passed for the exact head before normal merge with `--match-head-commit`; no admin
bypass or force update occurred. Root verified mergedAt/merge/head and candidate
ancestry, and the integrated tree equals the reviewed tree. Clean primary `main`
and the managed runtime checkout advanced to the merge. Owned local and remote
P06 branches were deleted; unrelated branches and source links were preserved.

Scoped cleanup preserved 163 complete private archives, then removed 162 exact
inventoried temporary roots with zero skips. Fresh canonical path, UID/device/inode
and open-file guards preceded removal. Root independently checked all archive
hashes/manifests, 55,277 members, 52,822 regular-file byte hashes/modes, and absence
of every removed path. Both failed and accepted performance datasets and P05
cached assets remain preserved; a partial FIFO archive is separately classified.
Raw/public proof and current runtime assets remain unchanged. Unenumerated earlier
temporary directories and operator data were not claimed or removed.
[The public cleanup summary](implementation/evidence/P06/cleanup-summary.json)
records verification hashes without exposing credential archives.

Next: plan P07's Phase 2 checkpoint, obtain Astra medium approval, then execute
isolated-install, combined-load observer sampling, recovery/auth/keyboard/license
and full relevant validation under the execution policy. P07 is not a v0.1 release;
continue through W01–W04 before the final independently reviewed v1 source release.


## Current P07 handoff

Earlier full verification passed at executable source
`2b27403a797dcb3c7a640b14a0b104ac611d154a`: 153 unit tests in 32 files,
396 integration tests in 63 files, and 34 actual Chrome journeys. Full lint,
types (`--incremental false`), OpenAPI and diff checks passed. The final
`9c5bc701a7ff9fda6961de9d54a7e0c23bfd83c3` delta is documentation and public
synthetic evidence only. Coordinator documentation updates precede independent
Standards and Spec review of the exact integration candidate.

Astra medium approved the original P07 plan and the bounded measurement and
warm-accounting repair plans. The final repair plan SHA-256 is
`78c28dd784956130671550d0e1649d0599414df7200d941a42ae6cfadcb1a966`;
its approval is `1232c041cf9badb54b16b5f02c17124a96cbca6c3ad30f390ab8e57e2a4205bf`.
Independent shipping/helper readiness approval at `2b27403` is
`c94d981cd7192fa3b77de11d51e982d2397811fc933823e3872212af058afec6`.
The shipping change moves initialized outbox accounting behind its existing
native publication lease. Cold bootstrap, ownership, quotas, durable preservation,
sequence allocation and delivery contracts retain focused regression coverage.
An independently controlled filesystem/native-lock race supplied a real ENOENT
counterexample. It does not establish the cause of an earlier aggregate test
failure whose six individual outputs were unavailable. New concurrent tests
retain every actual child return before asserting.

Historical application measurements belong to `534140b`: three full load scenarios
with 21,000 timed events, 384 confirmed browser targets and no missing/wrong/late
targets or strict missed slots. Sustained HTTP p95 was 21.65–22.02 ms; worst
visible p95 was 528.20 ms. Three native comparisons retained 4,200 measured
samples plus 420 warmups; worst p95 was 1.947 ms and worst positive change
10.302%, below the 20% budget. After 100 connection cycles, server heap changed
+0.728%, stream leases returned to baseline and shutdown resources reached zero.
Applicability to current application code is proven by 87 unchanged application/
build inputs, 417 exact retained assets and a checked import graph excluding the
changed CLI module. These are attributed application measurements, not a current
execution of the whole earlier campaign.

The changed CLI was measured separately at `2b27403` through three fresh
1,000-report fixtures. Startup-inclusive flush walls were 92,815.614, 92,462.684
and 92,634.664 ms, all below 120,000 ms. Root reconciled 3,000 unique original
queue bodies, full HTTP acknowledgements, API, SQLite, stdout and sequence
watermarks, with zero pending/missing/duplicate originals. The 32 exact HTTP 200
replays are separate. Setup time is excluded and disclosed. No relative CLI
speedup is claimed.

Root matched the final freeze, 416 tracked files in both sources, 52,889 new
regular-file hashes, 55,119 descendant identities/modes and all five historical
inventories. Three intentional FIFO fixtures were classified without reading
them. Original ignored outputs were restored with their bytes, modes and inode
identities; the previously absent review output subtree remains absent. Main
assets, native addon and installed tool hashes match; post-audit scoped lsof
was empty. Root inspected both published screenshots and verified the whitelist
receipt. Private full evidence stays outside tracked data; public files contain
synthetic identities and summaries. Root's final verification receipt SHA-256 is
`8ffafba91d1c919c753149636e727226488d6a4cd3d1e5d15ea5ada999cda05b`.

The fresh installation began at `9727bf9` with no node_modules or build output
and reused the global npm cache. Named host: macOS 27.0 build 26A428, arm64,
Node 24.15.0, npm 11.12.1 and Chrome 154.0.8037.99. Retained initial production
assets qualify the unchanged application; the changed CLI executes current tsx
source. There is no pristine-OS or Linux claim. Browser accept/reopen scenarios
exercise synthetic human-role commands, not actual human attestations. Burst
visibility has four samples per tab/scenario, so nearest-rank p95 equals maximum.
Decoded UTF-8 response text is distinct from transport bytes. Dependency notice
completeness and dev-tool audit limitations remain in the receipt.

Next: independent Standards and Spec review of the coordinator's exact candidate,
then guarded PR/normal merge, owned artifact cleanup and W01 planning/Astra medium
approval. P07 remains unchecked until integration; no v1 tag/release is created here.


### P07 default-unit portability finding and repair

Standards and Spec review at `740869af215458d4d599b952ba0a0806fe492c0d`
found one shared P2: default unit verification depended on a private historical
`.next` identity and P06 source equality. Generic negative assertions could mask
their target with an earlier environment failure. No other blocking finding was
identified. Their original reports are retained with SHA-256
`ee85f440d6e779b5c115bd3c71bffcdb3b562071434a74e8fd62425a86afd882` and
`093a2aa1ef1da211a18e69d4c7196267b8d41b196922a6113899a39964f15029`.

Astra medium approved bounded repair plan
`956c6ffa89c5ac3d414d421fb867e914f0f22b82cceef7a48772e7fd34ebc881`
with approval `09b723698a8349c6929eb72c0188071b9b8577ffce5f043de2b0d7dd7dc1f8e1`.
Commits `a6a5494` (test), `05af793` (fix) and `378ce33` (docs) separate the
fixed policy from actual qualification acquisition. The real measurement wrapper
still acquires and validates Git differences, byte equality, CLI hash, the exact
417-asset aggregate and the actual import graph, with no passing overrides or
skips. Hermetic unit cases test one corrupted fact and its specific reason.

Actual RED in a new full-history clone without `.next` was one failure and three
passes: the positive test raised ENOENT. At executable
`05af7932868438659e1be12f68c00d76582bed4b`, **156 unit tests in 32 files passed
in 3.51 seconds without a build**. Seven focused controls passed both before and
after an uncommitted synthetic launcher comment in only that disposable clone.
The actual historical guard rejected the changed input specifically before any
missing-build error. Existing pinned dependencies were linked, not reinstalled.
Full types with incremental writes disabled, lint, OpenAPI and diff passed.

The repaired real guard ran read-only once against the retained build. Root
independently matched its 417 assets, 87 inputs, reviewed CLI hash, 67 modules,
28 roots, edges and CSS leaf to the earlier freeze and current files. Root also
matched 4,034 new regular-file hashes, 4,444 identities/modes, 417 tracked files
in both clean candidates, actual logs, the build-absent clone, its isolated drift,
core evidence/tool/addon hashes and public receipt append. Scoped lsof was empty.
Root repair verification SHA-256 is
`d21ee274e48812c7737147e55386f03ccb7de9009cf0a6d9d54d094f05037d1c`.
The first coordinator read check used an incorrect public field name; correction
was a read-only tooling fix, with no test/product rerun or artifact mutation.

The final worker candidate `378ce33d56c55b8e9e5efdf9e3ac88bef877ee13` changes
only documentation/public attribution after executable `05af793`. Application,
CLI, migrations, package/config, integration/browser and timed measurement-stage
inputs are unchanged from their recorded executions. The 396 integration and
34 Chrome passes stay attributed to `2b27403`; application performance stays
`534140b` and repaired CLI throughput stays `2b27403`. New portable unit/static
results belong to `05af793`. No result is relabeled as a new whole campaign.

Next gate is both original independent reviewers' exact repaired-candidate
closure, including this coordinator documentation commit. Guarded PR/normal
merge and archive-before-delete cleanup follow; W01 remains unstarted. Cleanup
preparation lists exact owned roots and an absent historical review-path exemption.
No archive or deletion has occurred, and no P07/v1 release is claimed.


## Verified P07 integration and cleanup

[PR #10](https://github.com/AlesSystems/agentflow/pull/10) merged on
2026-10-11 at 00:39:39 UTC. Reviewed head
`b680468166d7716008d433ba6c8d6a12ee4a9838` passed independent Standards
closure `55f0f806d35a10691a3b9bf871a5d64c884cde0400d500eeaeeacb69992d35f8`
and Spec closure `f75cdeedfab7b98a4eb9e6753a691d9cdf28cce928ea9a5c1ec2bc3f631665eb`.
Root read both complete reports, confirmed local source/origin and immutable
report hashes, and verified GitHub's exact open non-draft head/base, MERGEABLE/CLEAN
state, empty checks and active rules, and unprotected branch response. A normal
matching-head merge used no override. Merge
`dd26c4b00867e7680c3baf0cf2be39b60502aecf` has parents P06/base and reviewed head;
its tree `94387f89b3b9ae7a665aee4ad272e394a0912707` equals the reviewed tree.
Candidate ancestry and actual merged state were verified. Primary fast-forwarded
cleanly; the completed local and remote P07 branch were removed.

All 14 exact authorized temporary roots were preserved in private user-only
archives, fully verified before any deletion, then removed with final identity,
byte, resource and safe-removal guards. Root independently read all 14 archives:
167,153 members, 156,966 regular files, 123 symlink records and six FIFO records.
Member sets, regular bytes/hashes, type/ownership/modes/timestamps, available flags
and link metadata matched; exact authorized-root absence and both protected
repositories' clean state passed. Root readback receipt SHA-256 is
`fbe7bbf9733ab28b80136316cb35227e953c4a84ad2da2c4e03a0121b3ac30da`;
worker final receipt is `f13cb739b54c08e0c9f272ada3125b51357c779333022ff9b1f659388deb96d6`.

The first archive attempt failed before members because Python lacked xattr APIs;
its partial and failure record remain preserved. A later portability archive
was held for one Git-index inode difference; its original/current bytes, owner,
device and permissions were identical. Root independently confirmed that exact
exception before replacement archival. Its replacement actor is unknown. No
other guard was waived. Extended attributes, ACLs and sparse allocation layout
are not captured; these are byte/basic-metadata archives, not complete macOS
backups. An already absent historical reviewer path remains an explicit exemption,
with no guessed cleanup or assertion that unavailable historical files were saved.
Global caches, operator data, primary checkout and managed worktree were retained.

P07 boxes and its qualified Phase 2 performance targets are complete. W04 still
requires fresh integrated-v1 validation. There is no P07 release. Next: the W01
reported-workflow plan, Astra medium approval, then real persistence/CLI before UI.

## W01 ready for final integration review

Executable `7eb85f3ab9ccb93405e283541e86501fa5f19260` implements immutable bounded
plans, revision-bound observations, typed durable workflow CLI producers and
read-only graph/list evidence. Independent source closures resolved backend,
CLI durability, UI binding/focus and measurement-helper findings. The final
documentation/public evidence candidate still requires exact Standards/Spec and
coordinator verification before the guarded package PR and normal merge. No W01
integration, W02 work or release is recorded here.

The [W01 receipt](implementation/W01.md) and
[allowlisted synthetic summary](evidence/W01/acceptance.json) record actual sources,
commands, results and limits. Full unit passed 173/173 at `f0aab8d`. Integration
composes 71 fully passing files from the original failed invocation with eight
corrected evidence-destination files (16/16), covering 457 unique contracts at
unchanged `f0aab8d`. Chrome composes 54 original passes at `9907003` and three
scoped corrected passes at `7eb85f3`, covering 57 unique contracts. Original
failed commands retain their original exits; neither composition claims a fresh
all-pass full command at the measured source. Types, lint, OpenAPI and production
build passed on the final file inputs. Unit/integration have no invocation-specific
bracket receipts; exact Chrome/source/build qualification and the historical
overwritten-build limitation remain explicit.

One coordinator-released quiet `--acceptance` invocation exited 0 on 2026-10-11.
An independent full-original audit joined 2,340 sampled original ACKs, 1,320 task
creations, 660 durable registration originals and typed pre-forward spool/state
bytes to 18 actual immutable checkpointed SQLite databases. Counts were 5,280
existing HTTP records, 2,640 real comparison CLI samples and 1,980 new workflow
HTTP records, including each 100 measured + 10 warmups/source/operation/repetition.
Three visibility scenarios yielded 60/60 exact observations, graph30/list30,
with every missing/wrong/duplicate/hidden/unconfirmed/late count zero. Graph p95
was 750.002042 ms, list 632.722833 ms and overall 749.125125 ms. Worst existing
head HTTP p95 was 2.222959 ms, worst new workflow HTTP p95 1.666042 ms and largest
existing relative p95 change 14.425973%, within the approved limits. CLI wall
timing includes startup/native work and uses its separate bounds.

Exact base/head sources, helpers, 803 compiled files, native addons and 38 prepared
files stayed unchanged. Scoped post-run ownership census was empty; cleanup
flags/timestamps retain their qualifications. Current-lock fresh checkout
installation contains 486 packages, exact React Flow 12.12.0 and 20 added notices.
Production audit is zero; nine development records match P07 and 33 unknown
installed baseline notice entries remain explicit. This is named-macOS finite
W01 evidence, not pristine-OS/Linux, physical power-loss, W04 or human attestation.
Four current synthetic desktop/narrow workflow/board exports are linked in the
receipt; later captures were export-only, without a third design iteration.

Remaining: exact final candidate/evidence review, coordinator verification,
guarded PR/normal matching-head merge, archive-before-cleanup and only then W02.
Package completion boxes remain open until reviewed integration. No tag or
complete-v1 claim is made.


## Verified W01 integration and cleanup

[PR #11](https://github.com/AlesSystems/agentflow/pull/11) merged at
2026-10-11 07:47:26 UTC. Exact reviewed head
`4e527a4b1fc31200eeda45a72a67d214b4b064ea` has the same tree as merge
`e5bf6da0e22a64b40fc5817fb1d3a4d237bdb168`. Root read complete independent
Standards and Spec reports, verified no blockers, exact GitHub head/base and
normal matching-head integration, and confirmed candidate ancestry plus clean
primary fast-forward. Report hashes and guarded cleanup qualifications are in
[the W01 receipt](implementation/W01.md#integration-and-cleanup-on-2026-10-11).

All 254,437 private archive members and 1,057 critical files passed independent
streaming verification before exact identity-guarded removal of the owned
temporary root at 08:33:46 UTC. The archive remains private. Original and
quarantine roots are absent; the completed owned branch is removed locally and
remotely. Primary and reusable managed checkout are clean at the merge. No
operator data, skills, external pins, or global caches changed. Historical runtime
results retain their original sources and qualifications.

W01 completion boxes are closed. Next is the [W02 implementation plan](superpowers/plans/2026-10-11-w02-dependencies.md),
then exact-plan Astra medium approval before its first source change. W03a–W04
and source release remain open. No tag or complete-v1 claim is made.


## W02 backend and CLI progression

Exact-plan Astra medium approval preceded implementation. Approved plan SHA256
is `1d9ff305efa848b8a01e51d3cfb5377a3bdb9f506cf0dd1202d6776c6a9da0df`; its
review report hash and complete source lineage are in [the W02 receipt](implementation/W02.md).
Backend/CLI checkpoint `fc02721e8497ccea2d9ced93b766d0b277624c63` passed independent
Standards and Spec progression review and coordinator verification. Two reproduced
findings were repaired: actual stored UUID identity for dependency writes and
safe actionable CLI conflict diagnostics. No source blocker remains at this gate.

Actual checks include 177 unit tests at clean application candidate `1d539da`,
qualified upgrade/repair/race checks, three clean CLI cases at `2fba0d5`, and
Store/SQLite current-evidence recovery and archived receipt checks. The coordinator
verified recorded input attribution, actual retained rows and pending bytes. Prior
failed commands, pre-commit attribution, overwritten failed scenario JSON, and
unbracketed private helper hashes remain explicit limitations. Synthetic operator
fixtures are not human attestations. No historical check is relabeled as a run at
the later documentation checkpoint.

Tasks 1–3 are closed in the [W02 task checklist](superpowers/plans/2026-10-11-w02-dependencies.md).
Next is Task 4 UI under the same approved plan, followed by final browser/suite/
performance/exact-review gates. All W02 package completion boxes, W03a–W04 and
source release remain open. No W02 PR or merge is recorded at this stage.


## W02 UI progression

Task 4 passed independent Standards/Spec at exact
`8f1e46bc7f1005b47333188d0f153672248035f1` and coordinator source/data verification.
The [receipt](implementation/W02.md#verified-ui-progression-and-command-ownership-repairs)
records two reproduced command-ownership discard defects and their narrow guards,
actual body/key/receipt joins, current-versus-historical Graph/List facts, two-context
rework/acceptance, dirty/reprepare/lost-response recovery, keyboard/375/native200
checks, valid captures, and source-stage qualifications. Native captures preserve
actual zoom; earlier cropped/protocol-failed images remain invalid historical evidence.
Two self-inspection batches per surface are complete, with no further style polishing.

The coordinator read both complete reports, verified hashes, matched all 514 source
blobs and 46 indexed receipts, and inspected actual SQLite retries. Metadata, comment
and completion preserve original keys and bodies; no duplicate comment/completion
is stored. Synthetic acceptance remains distinct from human attestation.

The [task checklist](superpowers/plans/2026-10-11-w02-dependencies.md) closes Task 4.
Next is Task 5 final executable suites and measurement-helper controls/preparation.
Real timings require a frozen-input quiet release from the coordinator. All W02
package boxes, W03a–W04, PR integration and source release remain open.

## W02 final preparation gate

Source/helper candidate `de24f611ac4db630d2ec1b732b786a53db32acc8` passed scoped
independent Standards and Spec closures after actual controls reproduced and
repaired measurement method, original CLI ledger, current-version, generation,
visible-value, denominator, failed-request retention, deadline, private-copy and
minimal/full receipt comparison defects. These are helper progression approvals;
actual timing and final package review remain open. See [the receipt](implementation/W02.md#w02-task-5-preparation-and-source-qualification).

The original unit run passed 182/38 before later helper changes, followed by 11
current helper cases. Integration retains its original 469-pass/5-fail result and
affected 42+1 repairs covering 474 distinct cases; it is not a retrospectively
passing whole invocation. Chrome passed 61 with no skips at `a767c7b`; six current
W02/control journeys passed against the fresh production head. Final lint, types
and OpenAPI passed. Historical input and failure qualifications remain explicit.

Fresh W01 base and W02 head installs/builds use the pinned runtime and their own
locks/addons. The head application build was made at `f49d030`; later helper-only
commits preserve all application/lock/addon bytes. Host qualification is macOS
27.0 build26A428, arm64/Apple M4 Pro, Node24.15.0/npm11.12.1, Chrome154.0.8037.99;
this is a fresh checkout on that host, not a pristine-OS or Linux result.

Preparation and nonacceptance control passed with separate source-correct
1000-task/10000-event seeds and the head-only workflow/diamond/gate fixture.
The coordinator independently verified 825 compiled files, application/helper/
native/runtime hashes, 15 unchanged frozen data files, seed counts/integrity/FKs,
53 receipt hashes and source qualifications, raw control receipts/spools/SQLite
joins, and twelve literal-value/two-frame/route/tuple confirmations. Control keeps
48 not-run slots in its 60 denominator; it supplies no performance budget pass.
The full declaration has 10230 operation samples, three interleaved repetitions,
100 measured plus ten warmups per group, and all 60 visibility slots.

Next: final frozen-input quiet release, one real campaign, metric/regression
decisions, exact final candidate reviews, normal matching-head PR merge and
archive-before-owned-cleanup. All W02 completion, W03a–W04 and source release boxes
remain open. No timing, merge, or complete-v1 result is claimed here.


## W02 Task 5 metric and data gate accepted

The coordinator accepted the one released journal-protocol quiet campaign at clean
`8b76bed7eab2ebe35630cb366e4a2b257970bb9a`, after independent raw/SQL, journal,
numerical and input-provenance audits. All 10,230 declared samples are present
(930 warmups, 9,300 measured), with 16,830 setup records and 60 strict current-value
confirmations. Missing/unconfirmed/wrong/duplicate/hidden/late/failed and cleanup
counts are zero. Worst existing relative p95 is +16.383%; no >20% Astra exception
is required. Maximum head existing/new HTTP group p95 is 8.535/9.611 ms, CLI group
p95 655.902 ms, and overall visible p95 735.862 ms. Maximum scenario/view p95 is
782.684 ms. All 3,366 ordinary native full-drain clocks are <=5 seconds.

Fifteen deliberate queued setup invocations take roughly 5.1 seconds before the
measured visibility clock, exit 2 after synthetic 503s, and retain the separate
20-second hard bound. They are not five-second CLI metric passes. Serial 15 ms
cooldown is outside sample clocks; W04 still owns integrated combined-load and
unrestricted throughput proof. The [public synthetic summary](evidence/W02/acceptance.json)
and [receipt](implementation/W02.md#accepted-w02-task-5-metric-and-data-gate) preserve
all group/view reductions, original failure and source/build qualifications.

Current full unit passes 199/38 at clean `8b76bed`. The historical whole integration
and Chrome invocations retain their original sources and honest composed repair
coverage. Quiet01/02 remain failed; quiet02's cause remains unproven. Final head
installation/build is actual `8d44b0d` with unchanged application/lock/addon/compiled
bytes through `8b`; documentation does not claim a new build or whole-suite rerun.

Task 5 measurement/evidence preparation is complete. Remaining gates are Root's
public-allowlist/documentation verification, fresh exact-candidate full-W02
Standards/Spec review, guarded PR/normal merge and archive-before-cleanup. W02 is
unmerged; package completion, W03a–W04 and source release remain open.


## Verified W02 integration and cleanup

W02 passed independent full-package Standards and Spec review at `cc3344bcf2fd210ae1536c28f73f508c0e6a6c37`.
[PR #12](https://github.com/AlesSystems/agentflow/pull/12) merged normally at
18:50:30 UTC on 2026-10-11 to `1ce0c52ab9fedab0b8a61eb8c15131c2d8e69361`. The merge tree equals the
reviewed tree, ancestry is verified, and the primary checkout fast-forwarded cleanly.
The branch had no required checks or active protection rules; this does not claim
that CI ran. No bypass or force merge was used.

The coordinator and archive worker independently verified the complete private
archive, including every file hash, before a final original-tree guard and removal
of the owned test environment. All 309,853 members and 12,289,494,076 regular-file
bytes are retained. The archive is 3,138,513,509 bytes, SHA256
`0cc97eebcd7acf4f03419329c6a918cb2a4f87fd5cba793fb907fc91667be730`.
Symlinks, hardlinks, FIFOs and basic metadata are preserved; xattrs, ACLs and
physical sparse allocation are excluded. No complete macOS backup is claimed.
Original and quarantine roots are absent; permission repairs were zero. Only the
completed owned branch was deleted. Global runtimes, skills and operator data
were untouched. W03a is next; W03b, W03c and W04 still gate v1 release.


## W03a qualified verification accepted

At executable `3484cb4a20cd0070efdb1aa5c195043a9559d025`, Root accepted the
read-only GitHub implementation/verification after independent readiness,
original-data/source and numerical audits. The [receipt](implementation/W03a.md)
and [allowlisted public evidence](evidence/W03a/acceptance.json) retain the original
quiet exit 1/validfalse and the Astra medium exception for `settings-regression-3`.
All three settings comparisons remain visible; round 3 increases 24.912740%, or
0.208416 ms. Its cause is unknown, no resample occurred, and no W04 waiver is made.
Every existing/new local snapshot group is strictly below 250 ms. All 990 original
requests,90 warmups/900 measured samples,9 graceful services and zero outbound calls were
independently reconciled. Pairing session writes are expected; six cache/read-fact
snapshots remain unchanged.

The original full unit 201/39 and Chrome 72/no skips pass at `60827b8`. Original full
integration 493 pass/3 fail of 496/93 files remains exit 1; affected 19/2 passes close
three additive-migration validators. Ten later qualification controls yield 506
unique integration contracts in composed coverage. Eight focused consumer repeats
are not added again. Types/lint/build pass; the npm OpenAPI IPC setup failure is
preserved with its successful direct Node import-tsx reroute. Both measured sources
have their own qualified locked installs/builds/native modules. Current production
inputs 108 and compiled 442 are unchanged through the measured source. Optional
live GitHub is unexecuted; existing-host, synthetic acceptance, historical raw-build
and global-cache evidence limitations remain explicit.

Only documentation and the four selected existing synthetic images are published
here. The original approved plan digest remains a historical input even though
its execution checklist now records the qualified stages. Final exact-candidate
Standards/Spec review, Root public audit, scoped PR creation/attachment, normal
matching-head merge and private archive-before-guarded-cleanup remain open.
PLAN package boxes stay unchecked. W03b has not started; v1 is not complete.


## W03a repaired-source qualification accepted

Root accepted `1931221636894cd5840e98a4f83d4a13bdb85b1c` after the Spec rate-gate
repair, exact readiness, independent actual-run data/source audit and a new Astra
exception. Repository Save/disconnect/re-enable/scope changes retain active
Retry-After; one SQL reset was removed. Fresh affected 17 cases compose 16 original
passes with 1 post-build HTTP pass; the missing-build setup failure stays retained.
The strengthened durable 3 repeat and amended existing Chrome 1 are qualified
repeats, not added totals. Current composed integration 507 is 496+10+1; broader
unit 201/39, Chrome 72 and original integration failures/repairs remain historical.
Fresh types/lint/direct OpenAPI/build/native pass. Current 442 compiled files use
new build ID `4Vb1NNuhxLbtEfGR4huj6`, not historical hashes. Only 1 of 108 production
inputs changed; actual build input/dirty qualification precedes later test/docs.

Keep three distinct records: historical 3484 measured exit 1/validfalse with its
round 3 +24.912740% exception; repaired 193122 launcher setup exit 1 in 0.905663666 seconds
before declarations/services/samples and no aggregate/percentiles, explicitly
approved setup reroute; repaired 193122 actual run02 exit 1/validfalse in 5.402974708 seconds
with new round 2 +33.600795%/0.258376 ms exception. All three current comparisons are
positive; cause unknown, no noise assertion or same-source resampling. Every
current group p95<250 ms, maximum 1.247416 ms. All 990 originals/90 warmups/900 measured,
9 graceful services, zero outbound, six unchanged protected fact pairs and expected
session 4/7 writes are independently reconciled. Old exception is not inherited,
and neither exception relaxes W04 or future-source gates.

[Receipt](implementation/W03a.md) and [public allowlisted reduction](evidence/W03a/acceptance.json)
separate both measured sources, setup failure, build and coverage qualifications.
Old main/probe and the new repair-root archives are private and Root stream-verified.
Exact final whole-package Standards/Spec, public audit, normal PR attachment/merge
and guarded cleanup remain open. PLAN package boxes remain unchecked; W03b and
v1 completion remain unclaimed.

## Verified W03a integration and cleanup

This later closure supersedes the open integration gates in the preceding
preintegration snapshots. It does not replace their source or numerical results.

[PR #13](https://github.com/AlesSystems/agentflow/pull/13) merged normally at
`2026-10-11T22:52:31Z`, using `--merge --match-head-commit` against reviewed
`8f63d231ff63d8b77c51573fad9790be8ac78c9d`. Merge
`76fe748a3d642f8a5a6ea738af47a3bb640070d3` has the same tree
`3b77fd7766b8753e8b76a218cc0c39e7638ca9c6`, and the reviewed head is its ancestor.
Both final whole-package review axes approved with zero actionable findings.
The private Standards report has SHA256
`5c878212b2a82e5f0ef630e718c07944cb9e631d616ff3c51c28ed6a1b70afd8`;
the Spec report has SHA256
`c0611ea44e2d3a8858e7f53d361abafd272f2f06ebceb2599c81c350b00a61fb`.
No admin, force, or protection bypass was used. No GitHub checks were configured;
the local proof and independent review gates governed integration.

Root verified original private archives for the main, probe, and rate environments
across 324,942, 9, and 40,229 entries respectively. Guarded deletion checked actual
original types, basic metadata, and SHA256 before removing the three owned roots
and their quarantines. All six paths are absent, with zero permission repairs.
Private archives retain byte, type, hardlink, symlink, FIFO, stat, and nanosecond
metadata evidence. They exclude extended attributes, ACLs, and physical sparse
allocation. The completed owned local and remote branch is removed. The managed
and primary checkouts were retained clean at the merge. No global cache, skill,
or operator-data cleanup occurred. Early global npm effects without a before-census
remain an unresolved historical qualification.

The private Root integration receipt has SHA256
`ca98501500623bdf29c5bf614e19d3b147f683852343ff433f27462e0506c371`.
The private Root cleanup receipt has SHA256
`b617207de8c8fc90bc45163e3609a080d4ae62754eecb7226857f8138d9b7e0c`.
Both original receipts were read in full and rehashed for this closure. Frozen
public acceptance JSON and appearance images remain unchanged. Optional live
GitHub verification remains unexecuted. W03a package boxes are complete. W03b
planning and its Astra medium approval precede implementation; W03c and W04
remain unstarted, and no v1 release is claimed.
