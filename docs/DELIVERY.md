# AgentFlow v1 delivery ledger

Status: five packages passed acceptance, independent review, coordinator verification
and integration. [PR #4](https://github.com/AlesSystems/agentflow/pull/4) integrated
P01 at `a2e5170879602faff706e1aa2e5e7a1905d63b47`.
[PR #5](https://github.com/AlesSystems/agentflow/pull/5) integrated P02 at
`f0b3cf2b6588d7d5028757e4ad316b74dff6eb3c`. [PR #6](https://github.com/AlesSystems/agentflow/pull/6) integrated P03 at
`cf44dd9103c091c10c9608468e5956e506c6705c`. [PR #7](https://github.com/AlesSystems/agentflow/pull/7) integrated P04 at `d84a455ff167ecfdc7ef1afc1c6e4a1983cae1fe`. [PR #8](https://github.com/AlesSystems/agentflow/pull/8) integrated P05 at `787865132d89a9b03f613942f64945887bc13f95`. P06 producer, performance, and full validation checks passed; final independent review and integration remain open. P07 through W04 have not started.

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
| P06 | CLI hooks | Implementing | Tested runtime `4bb6dee4c269f493723c6b684eec1e8606a07528`; branch `codex/v1-p06-cli-hooks` | [Acceptance checkpoint](#p06-acceptance-checkpoint); final review and integration open |
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
