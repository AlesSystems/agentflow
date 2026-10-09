# AgentFlow v1 delivery ledger

Status: planning only. No implementation package has started. This ledger is a
resume contract for the future [one-prompt run](EXECUTION_POLICY.md#starting-the-future-run).
PR #3 contains the design and expanded delivery proposal; its documentation review
is not evidence of application implementation.

## Package state

Advance sequentially. A package is complete only after its acceptance gate,
independent review of the candidate SHA, and verified integration all pass.

| Package | Deliverable | State | Candidate / integrated SHA | Evidence |
| --- | --- | --- | --- | --- |
| P01 | Runtime/storage | Not started | — | — |
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
