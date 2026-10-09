# AgentFlow roadmap

Status: planned. Only repository creation and design documentation are complete in this change. Every application milestone below remains open. Dates will be assigned after the first runtime spike establishes the work involved.

## Release boundary

v0.1 is a local task manager with reliable observation of an external agent harness. It includes both foundation and generic integration. A manual board alone is an internal checkpoint, not the first agent-tracking release.

| Milestone | User outcome | Delivery units | Exit condition |
| --- | --- | --- | --- |
| Phase 1. Foundation | Create projects, manage a board, inspect history, and record human acceptance | P01-P03 | Data survives restart; the complete board journey works with keyboard and pointer |
| Phase 2. Agent integration | See registered agents, attempts, failures, stale reports, and automatic progress through Review | P04-P07 | A real CLI report reaches SQLite and both browser sessions, including retry and reconnect cases |
| Phase 3. Workflow tracking | Inspect orchestrator plans, assignments, dependencies, review cycles, and reported workflow state | Future W01-W03 | A branching workflow and rework cycle can be traced without implying that AgentFlow executes it |
| Optional control release | Launch or stop approved agent processes through explicit operator actions | Separate proposal | Approved execution and credential design, then isolation and cancellation evidence |

The ordered work packages and their verification requirements are in [PLAN.md](PLAN.md). The operator-approved [execution policy](docs/EXECUTION_POLICY.md) defines delivery authority and the amended review and installation gates. Implementation remains unstarted.

## Phase 1. Foundation

- [ ] P01 proves the production runtime, SQLite driver, authenticated local access, migrations, and backup/restore.
- [ ] P02 delivers project and task commands, comments, completion evidence, versions, and activity records.
- [ ] P03 delivers Overview, project boards, task details, filters, and accessible interactions.

One project has one board with Backlog, In progress, Review, and Completed. Task fields include title, description, acceptance criteria, priority, tags, assignment, blocker, parent task, and branch/PR metadata. Comments and human acceptance remain in history.

Foundation acceptance requires create, edit, move, complete, and reopen through a real browser. An API edit must appear after refresh. Invalid requests and stale versions must leave the database unchanged. Restart must preserve tasks and acceptance history.

## Phase 2. Agent integration

- [ ] P04 delivers stable agent identities, per-attempt runs, ordered event ingestion, and automatic task transitions.
- [ ] P05 delivers authenticated SSE, snapshot/replay, and the Agents and Activity views.
- [ ] P06 delivers generic CLI hooks with a durable outbox and a documented integration walkthrough.
- [ ] P07 proves clean installation, load limits, recovery, local security, and the v0.1 end-to-end journey.

Success means an implementation run moves a task to Review and a human can accept it with evidence. Retried events do not duplicate activity. A stale reporter remains visibly uncertain. Closing its record does not stop the external agent.

v0.1 ships when every P01-P07 acceptance gate passes on a production build using the execution policy's isolated installation on a named macOS host, with independent review at the release commit. This establishes support for the tested configuration, not a pristine-OS claim. Linux support is advertised only after equivalent checks pass there. The app remains usable without internet after installation.

## Phase 3. Workflow tracking

W01 adds reported workflow plans, versioned workflow runs, nodes linked to tasks/runs, and a read-only React Flow graph. Node selection opens the task and its event history. The graph reflects reported state and exposes missing observations.

W02 adds same-project dependencies with cycle detection, readiness explanations, review decisions tied to a work revision and artifact identifier, and explicit rework rounds. Before automatic completion is considered, a policy must define which evidence counts and how a new implementation invalidates earlier approvals.

W03 considers opt-in GitHub synchronization, retention/export tools, and usage analytics. PR links already exist as manual metadata in v0.1. GitHub credentials and outbound requests enter only with an explicit integration design. Missing usage remains unknown, and cost estimates need a named price snapshot, currency, and provider.

Sequence these as separate proposals after observing real v0.1 use. Parent-task grouping is not a substitute for dependency semantics. A workflow diagram is not a scheduler.

## Deferred product choices

Multiple users, LAN access, cloud synchronization, custom columns, arbitrary command execution, transcript indexing, mobile clients, a plugin marketplace, and desktop packaging are outside v0.1. A Tauri shell may follow once browser workflows are stable.

The operator selected MIT for AgentFlow-owned material; see [LICENSE](LICENSE). Exact dependency versions and the tested runtime configuration are resolved in P01. Their acceptance evidence remains required before release.
