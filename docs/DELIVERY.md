# AgentFlow v1 delivery ledger

Status: the operator activated the full v1 run on 2026-10-09. P01 implementation
and automated acceptance are ready for independent candidate review. No package
has been integrated from this implementation run. P01 remains open until review,
coordinator verification and merge succeed. Downstream packages have not started.

## Package state

Advance sequentially. A package is complete only after its acceptance gate,
independent review of the candidate SHA, and verified integration all pass.

| Package | Deliverable | State | Candidate / integrated SHA | Evidence |
| --- | --- | --- | --- | --- |
| P01 | Runtime/storage | Review pending | `52e684f35fbd7779f5ef79f5bca6e205ffe753ba` source evidence; final receipt HEAD awaits review | [Receipt](implementation/P01.md), [synthetic evidence](evidence/P01/acceptance.json) |
| P02 | Task contracts | Not started | — | — |
| P03 | Work board | Not started | — | — |
| P04 | Agent ingestion | Not started | — | — |
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
Source proof is tied to `52e684f35fbd7779f5ef79f5bca6e205ffe753ba`; the final
receipt commit changes only docs/evidence. Small commits preserve regression
red/green loops; no reset, rebase, force push, PR or merge was performed by the
writer. The coordinator owns independent review, PR creation and integration.

Final clean-clone commands passed installation, dependency-tree validation,
lint, types, production build, 6 unit tests, 41 integration tests, 2 Chrome
browser journeys and listener/HTTP/integrity/resource checks. The focused runtime
suite passed 27 tests. Production audit has zero findings; two dev-tool advisory
chains remain explicitly qualified in the receipt. Browser default Chromium
installation was cancelled after slow download; installed Chrome 154 was tested
in temporary profiles. Native use is the bundled darwin-arm64 prebuild, not a
claimed source compilation.

See the receipt and acceptance JSON for exact build identities, lock hash,
readiness/RSS samples, screenshots, historical failed checks and limitations.
Owned test servers and the incomplete browser download were stopped. Fixture
clones and synthetic data are retained for review; no operator data was used.

Next action: review the exact final branch HEAD on standards and specification,
resolve any blocking findings, independently verify critical production evidence,
then integrate under the activated policy. Do not mark P01 complete or start P02
before its reviewed integration; P02 also needs its own Astra medium plan gate.
