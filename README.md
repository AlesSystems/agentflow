# AgentFlow

AgentFlow is a local application for engineering tasks, agent activity, and review progress. It combines a simple Kanban board with execution history from your existing agent harness.

**Status: all 13 v1 packages are integrated; [v1.0.0](https://github.com/AlesSystems/agentflow/releases/tag/v1.0.0) is published at `fbb77c7d35271fba514692dae3dbae151a262b87`.** [W04's receipt](docs/implementation/W04.md) preserves the one raw false/exit 1 campaign and separate exact 14-group disposition. Pairing, the Work board, durable CLI reports, workflow graph/list, prerequisite/rework evidence, GitHub observation, export/retention and usage are runnable. Agent execution remains outside AgentFlow. The tagged source has passed independent release review; post-publication evidence is recorded in the W04 receipt.

## Product direction

- Build an original application with Next.js, React, TypeScript, and SQLite.
- Manage projects and tasks. Observe agents through explicit reports from their harness.
- Start with a common local HTTP API and CLI hooks.
- Keep the application, database, and execution history on the user's machine.

An implementation run that succeeds moves its task to Review. Completed means a human has recorded acceptance evidence. AgentFlow does not launch agents, execute tests, or infer what unintegrated agents are doing.

The interaction goal is the lightweight board experience of [Fizzy](https://github.com/basecamp/fizzy), with an original implementation and visual design. No Fizzy source or assets are included.

## See your existing Codex work

Open **Codex** in AgentFlow's navigation. Your local Codex chats appear automatically without reporter tokens or per-chat registration. Search by title or project path, switch to child agents, or select archived chats. Select a chat to inspect recorded task requests, agent updates, turn outcomes and child agents. The page refreshes every five seconds while visible.

The connector uses your installed local Codex app-server reader. It reads history and never starts, resumes or modifies Codex work. A finished turn is not human acceptance on the AgentFlow board. The reader cannot confirm another desktop process is currently running. Missing checklist percentages remain unknown. Remote-host and cloud-only chats are not included.

Keep Codex installed on the same machine and pair your browser with AgentFlow. The connector prefers Codex's managed app-server executable and falls back to `codex` on PATH. To select another installed binary, set `AGENTFLOW_CODEX_EXECUTABLE` to its absolute path before starting AgentFlow. No API key or extra account login is required by AgentFlow.

Only paired browser sessions can read Codex history. Reporter tokens cannot access it. Last successful observations remain visible during a temporary disconnect, labeled stale. The in-memory cache clears when AgentFlow restarts. Codex content is not imported into AgentFlow's business database or exports.

The [connector contract and verification](docs/implementation/CODEX_CONNECTOR.md) describe source limits and tested behavior.

## See your Claude Code sessions

Open **Claude sessions** in AgentFlow's navigation. Your local Claude Code sessions appear automatically, with their subagents and workflow agents. Search by title or project path, or switch to child agents. Select a session to inspect recorded requests, the latest replies, checklist progress where Claude recorded a task list, and subagents. A running session is labeled from Claude Code's live process files. The page refreshes every five seconds while visible.

The connector reads Claude Code's local transcript files directly, because Claude Code has no supported history interface. The format is undocumented and can change between releases; unrecognized records are skipped and unknown values stay unknown. It never starts, resumes or modifies Claude Code work, and never opens session keys, prompt history, settings or credentials. It reads `~/.claude` by default, or `CLAUDE_CONFIG_DIR` when set. To select another directory, set `AGENTFLOW_CLAUDE_DIR` to its absolute path before starting AgentFlow.

The same access rules as Codex apply. Only paired browser sessions can read Claude history, nothing is imported into AgentFlow's database or exports, and a finished turn is not human acceptance. The [connector contract and verification](docs/implementation/CLAUDE_CONNECTOR.md) describe source limits and tested behavior.

## Design documents

| Document | Purpose |
| --- | --- |
| [Product context](PRODUCT.md) | Confirmed users, purpose, constraints, and accessibility targets |
| [Design system](DESIGN.md) | Extracted Work board tokens, controls and recovery behavior |
| [Board surface brief](.impeccable/surfaces/src-app-projects-projectid-page-tsx.md) | First board composition, states, and P03 acceptance targets |
| [Work board design brief](docs/design/WORK_BOARD.md) | Static visual studies, evidence hierarchy, and v1 tracking scope |
| [Roadmap](ROADMAP.md) | Product milestones, release boundaries, and exit criteria |
| [Implementation plan](PLAN.md) | Ordered work packages and verification requirements |
| [Execution policy](docs/EXECUTION_POLICY.md) | V1 activation prompt, delivery authority, review gates, and stopping conditions |
| [Phase 3 contract](docs/V1_WORKFLOWS.md) | Workflow graph, dependencies/rework, GitHub observation, export/retention, usage |
| [Delivery ledger](docs/DELIVERY.md) | Package progress and evidence for resumable execution |
| [Architecture](docs/ARCHITECTURE.md) | System boundaries, stack, and proposed source layout |
| [Backend](docs/BACKEND.md) | Domain model, persistence, state transitions, and recovery |
| [Frontend](docs/FRONTEND.md) | Pages, interactions, accessibility, and live updates |
| [API](docs/API.md) | Versioned HTTP contract, execution events, and CLI behavior |
| [Decisions](docs/DECISIONS.md) | Accepted choices, alternatives, and remaining evidence gaps |

Impeccable initialization records the existing product plan and a code-first
workflow in `.impeccable/config.json`. P03 now has extracted DESIGN.md tokens and its design sidecar. The
[P03 receipt](docs/implementation/P03.md) records actual browser evidence, repairs
and its verified integration.

## Run the local application

Use Node **24.15.0** and npm **11.12.1**. The verified host is macOS 27.0 arm64. Install dependencies and build:

```sh
npm ci
npm run build
npm run local -- setup
npm start
```

Run `setup` in your interactive terminal before starting the service. It displays the separate pairing and reporter tokens. Open `http://127.0.0.1:3000/pair` and enter the pairing token. The reporter token cannot pair a browser. If the service is already running, stop it before using local maintenance commands.

`npm run dev` uses the same ownership and security gates. `PORT` selects a port from 1024 through 65535. The launcher binds only `127.0.0.1`; accepted Host/Origin values use `127.0.0.1` or `localhost` and that exact port. Use `npm start`, because direct `next start` cannot initialize or access private storage.

The default directory is `~/Library/Application Support/AgentFlow`. `AGENTFLOW_DATA_DIR` must be an absolute, real local directory. The data directory and backup destinations must be outside the active application
root (the canonical directory used by Next), including public/ and build/scratch
folders. Contained paths fail before private files are created. Directories require owner-only permissions (0700), files 0600, and current-user ownership. Unsafe existing files fail with a repair code. Use canonical paths; symlinks, including parent aliases such as macOS `/tmp`, are rejected. Network filesystems are unsupported; reliable portable network-volume detection is not claimed.

Sessions expire after 12 hours. Cookie reads accept same-origin and direct navigation; a different localhost port is rejected as same-site. Direct clients without Fetch Metadata remain compatible when supplied Origin is allowed.

See [the setup and recovery runbook](docs/RECOVERY.md) for migration failures, session revocation and outbox prefix limits.

Stop the service before maintenance:

```sh
npm run local -- credentials rotate
npm run local -- backup --output /absolute/protected/backups/snapshot.sqlite
npm run local -- restore --from /absolute/protected/backups/snapshot.sqlite
```

Backup refuses an existing destination. Restore verifies the backup, preserves the current database/WAL/SHM in a damaged bundle, replaces the database, changes its generation, and revokes every browser session. Credentials stay in the current external `credentials.json`; backups exclude them. Later observations absent from the backup cannot be recovered by restore. Never copy a live main SQLite file alone.

An interrupted restore refuses startup. Run `npm run local -- restore repair` while stopped to finish the recorded replacement. Preserve the marker and damaged bundle if repair fails. Do not delete the database or lock file to make startup succeed.

Verify with `npm run test:unit`, `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`. The full `npm run test:integration` also requires the historical prerequisites below; an ordinary checkout alone is insufficient. Install the default test browser with `npx playwright install chromium`. On a host with supported Google Chrome installed, `AGENTFLOW_TEST_BROWSER=chrome npm run test:e2e` uses a fresh Playwright profile. It does not use your personal browser profile. [P01 evidence](docs/implementation/P01.md) records the exact tested configuration and limitations.

### Historical integration prerequisites

The W03b upgrade contracts require `AGENTFLOW_W03B_HISTORICAL_ROOT` and a fresh,
precreated owner-only `AGENTFLOW_W03B_UPGRADE_PROOF_DIR`. Missing required evidence
blocks qualification. Do not skip mandatory suites or treat skipped inherited
cases as acceptance.

Use canonical, operator-owned directories outside the active application root.
The historical root contains `runtime/bin/node` at qualified Node 24.15.0 and
`sources/<package>` checkouts at these exact commits:

| Package | Source commit |
| --- | --- |
| P01 | `a2e5170879602faff706e1aa2e5e7a1905d63b47` |
| P04 | `d84a455ff167ecfdc7ef1afc1c6e4a1983cae1fe` |
| P07 | `dd26c4b00867e7680c3baf0cf2be39b60502aecf` |
| W01 | `e5bf6da0e22a64b40fc5817fb1d3a4d237bdb168` |
| W02 | `1ce0c52ab9fedab0b8a61eb8c15131c2d8e69361` |
| W03a | `76fe748a3d642f8a5a6ea738af47a3bb640070d3` |

Each checkout needs its own lock-correct dependencies and source-correct production
build. Preserve Git metadata for source-pin checks. Follow the
[isolated installation policy](docs/EXECUTION_POLICY.md) and
[qualified W03b source evidence](docs/implementation/W03b.md); do not substitute
latest-head builds or shared managed dependencies. Set the inherited prerequisites
as well. These example paths are placeholders for directories you prepare:

```sh
export AGENTFLOW_W03B_HISTORICAL_ROOT=/absolute/operator-owned/history
export AGENTFLOW_W03B_UPGRADE_PROOF_DIR=/absolute/operator-owned/proof/upgrade
export AGENTFLOW_W01_BASE_SOURCE="$AGENTFLOW_W03B_HISTORICAL_ROOT/sources/P07"
export AGENTFLOW_W02_W01_SOURCE="$AGENTFLOW_W03B_HISTORICAL_ROOT/sources/W01"
export AGENTFLOW_P06_SMOKE_BASE_SOURCE="$AGENTFLOW_W03B_HISTORICAL_ROOT/sources/P07"
# Set the remaining full-suite prerequisites below before test:integration.
```

The last variable supplies a qualified baseline for bounded P06 helper controls;
it is not historical P06 acceptance. Preserve original exits, complete streams,
source/build pins, and synthetic data evidence. The current W04 suite used these prerequisites and the additions below; this description is not a new end-user setup run.

### Complete W04 contributor verification

The current full integration/browser packet requires the historical prerequisites above, plus the W03b source at `6611e8e4ed8ec61d57be689a7cfd82ee75b9275e` for W03c upgrade checks. W03c accepts its qualified archive with the original `proof/W03b-source-qualified.json` certificate; do not fabricate that record or substitute a current build. Qualified historical installations are copies, not fresh installs.

W03b/W03c variables name the historical **parent** containing `runtime/`, `sources/` and `proof/`. W04's historical variable instead names its **sources subdirectory**, with W01/W02/W03a/W03b builds. W04 base is P07. Its controller requires qualified `current`, `baseline` and `runtime` siblings under one owned verification parent; the control temporary/proof roots must lie under that same parent. The head clone has its qualified dependencies/build, the baseline is exact P07, and the runtime has the owned Node/npm paths. Set required roots before importing fixtures, with data/proof/cache outside the active head clone; each proof root is precreated owned 0700. Values below are placeholders for prepared, independently qualified inputs:

```sh
export AGENTFLOW_W03C_HISTORICAL_ROOT="$AGENTFLOW_W03B_HISTORICAL_ROOT"
export AGENTFLOW_W03C_UPGRADE_PROOF_DIR=/absolute/operator-owned/proof/usage-upgrade
export AGENTFLOW_W04_HISTORICAL_ROOT="$AGENTFLOW_W03B_HISTORICAL_ROOT/sources"
export W04_VERIFICATION_ROOT=/absolute/operator-owned/w04
export AGENTFLOW_W04_BASE_SOURCE="$W04_VERIFICATION_ROOT/baseline"
export AGENTFLOW_W04_RUNTIME_ROOT="$W04_VERIFICATION_ROOT/runtime"
export PATH="$AGENTFLOW_W04_RUNTIME_ROOT/bin:$PATH"
export TMPDIR="$W04_VERIFICATION_ROOT/tmp"
export AGENTFLOW_W04_BROWSER_IDENTITY="$W04_VERIFICATION_ROOT/proof/actual-browser.json"
export AGENTFLOW_W04_APPROVED_SOURCES="$W04_VERIFICATION_ROOT/proof/accepted-source-build.json"
export AGENTFLOW_W04_APPROVED_SOURCES_SHA256='<exact-accepted-proof-sha256>'
cd "$W04_VERIFICATION_ROOT/current"
export AGENTFLOW_W04_JOURNEY_ROOT=/absolute/operator-owned/proof/journey
export AGENTFLOW_W04_UPGRADE_ROOT=/absolute/operator-owned/proof/upgrade-current
export AGENTFLOW_W04_APPEARANCE_PROOF_DIR=/absolute/operator-owned/proof/appearance
export PLAYWRIGHT_BROWSERS_PATH=/absolute/operator-owned/browser-cache
export AGENTFLOW_TEST_BROWSER=chrome
npx playwright install ffmpeg
```

For the recorded zero-skip appearance packet, set these inherited hooks before the browser run as well. Precreate every proof/capture directory as private 0700; usage data is a fresh disjoint external directory. Values remain prepared-input placeholders:

```sh
export AGENTFLOW_W01_VISUAL_DIR=/absolute/operator-owned/proof/workflow-ui
export AGENTFLOW_W02_EVIDENCE_DIR=/absolute/operator-owned/proof/acceptance-ui
export AGENTFLOW_W03A_UI_EVIDENCE=/absolute/operator-owned/proof/github-ui
export W03B_TASK4_PROOF_DIR=/absolute/operator-owned/proof/history-ui
export W03B_TASK4_FOCUS_PROOF_DIR=/absolute/operator-owned/proof/history-focus
export W03C_TASK4_APPEARANCE=contributor-verification
export W03C_TASK4_DATA_DIR=/absolute/operator-owned/data/usage-ui
export W03C_TASK4_PROOF_DIR=/absolute/operator-owned/proof/usage-ui
export W03C_TASK4_CAPTURE_ESTIMATE=1
npm run test:integration
npm run test:e2e
```

The browser identity is a private 0600 JSON record of the actual executable path/SHA256/version. The source/build file is Root's real accepted `ROOT_W04_SOURCE_BUILD_REUSE` proof, with its exact hash and qualified input bindings; an invented placeholder record is rejected. Acquisition/qualification of those inputs precedes this snippet.

Full qualification also records inherited visual-hook roots and the pinned ffmpeg capability required by the recorded appearance context, complete source/runtime/build/browser manifests, command census and original closures. See [W04 evidence](docs/implementation/W04.md#current-six-commands) and the fixture requirements for those private roots; default browser installation alone does not provide the recorded ffmpeg capability in a different cache. Mandatory missing prerequisites fail rather than count as a qualified pass. Historical source acquisition/restoration and installation must follow the [execution policy](docs/EXECUTION_POLICY.md), with complete original receipts.

The performance controller has separate prepare/control/run gates. `run` requires Root's exact prepared array plus independent readiness/byte/SQL/all-idle receipts through `AGENTFLOW_W04_QUIET_RELEASE`; an ordinary checkout/test command is not new campaign authority. W04 accepted one campaign only. Linux, pristine-OS and live-account checks remain limits, and no new manual end-user installation/launch is claimed here.

The app requires no cloud account, hosted database, Docker, or paid infrastructure. Package installation requires network access. Agent providers used by an external harness may have their own network requirements and costs.

Runtime data stays outside the checkout. A public source repository does not publish the local database or agent history. No telemetry, remote fonts, or external asset requests are part of the product design.

## Current delivery boundary

The target is **v1 across all three phases**, completed in order: foundation, agent
integration, then workflow tracking and supporting tools. The connected graph,
dependencies/rework, opt-in read-only GitHub PR observation, export/retention, and
reported usage are included. Agent process controls remain separate. See the
[roadmap](ROADMAP.md) and [starting prompt](docs/EXECUTION_POLICY.md#starting-the-future-run).

AgentFlow-owned material is licensed under [MIT](LICENSE), copyright 2026 AlesSystems. Retain applicable third-party licenses and notices.

The earlier approved P01–P07 execution controls are retained in the revised
[execution policy](docs/EXECUTION_POLICY.md). The operator activated the expanded v1 implementation on 2026-10-09. Sequential
verified integration and the source release remain gated by independent review.

### Optional read-only GitHub observations

GitHub observation starts disabled. In Settings, explicitly enable it and save up
to ten exact `owner/repository` names, one per line. Saving replaces the entire
selection. Choose one saved repository and fetch either a list page (20 PRs,
pages 1–1000) or a positive PR number. Only the explicit metadata fetch contacts
GitHub. The requested repository or exact PR is shown in Saved observations.
Use Browse cached repository and Next cached page to inspect further saved rows;
these controls and Refresh saved observations stay local. No linked task is needed
to view a manually fetched PR. Local refresh, navigation, focus and workspace
updates read cached data. Disconnect retains the cache and labels it stale.

For local credential setup, use a fine-grained GitHub token restricted to the
selected repositories with Pull requests read permission. Save it with the
`token` JSON property in a regular, single-link file outside the active checkout,
owned by the launching account, with mode `0600` and no symlink components.
Configure `AGENTFLOW_GITHUB_TOKEN_FILE` in the local launch environment and restart
AgentFlow. Do not paste a token into browser fields, URLs or shell commands. The
UI exposes only configured, unavailable or repair status. Configured does not
mean GitHub has verified the credential; an explicit fetch reports authentication
or credential repair failures safely.

Task details show cached metadata only for canonical GitHub PR URLs in selected
repositories. Their Open pull request link opens that canonical URL only after
explicit activation; unsupported and unselected links remain inert. Failed fetches retain prior observations and their fetched/attempted
times. A PR head change marks prior head observations and head-linked external
evidence stale. It never changes local task acceptance or infers the meaning of
opaque artifact references. Missing or inaccessible metadata does not prove a PR
was deleted. These controls are observations and cannot modify GitHub.


The [W03a receipt](docs/implementation/W03a.md) records deterministic fixture
verification, the rate-gate repair and two source-specific measured failures with
separate scoped exceptions, plus a retained launcher setup failure. Live GitHub
credential verification is unexecuted. Whole-package review, PR #13 integration, private archival, and guarded cleanup
are complete. The [W03b receipt](docs/implementation/W03b.md) records qualified
verification, independent review with scoped client repair re-review, PR #14
integration, and completed private archival and guarded cleanup. W03c reported usage, producer recovery, and the Usage page are implemented. The
[W03c qualification checkpoint](docs/implementation/W03c.md) records the fresh
locked install and source-qualified checks. Exact-source package reviews found no actionable findings at `fd44b95`. The
revised campaign completed all 3,810 requests and passed absolute budgets, but
its raw acceptance remains false for six relative regressions. Their exact
Astra disposition is approved and Root accepted the campaign. Final documentation
review, PR #15 integration, private archival, and guarded cleanup are complete.
W04 Tasks 1–4 are Root-accepted under the separate exact 14-group disposition.
Whole-candidate reviews passed; PR #16 integrated W04, and the independently reviewed source release is published.


### Reported usage and local estimates

Usage selects a project and an explicit UTC receipt interval. Known token
subtotals remain separate from unknown counts and runs without reports. Optional
named local price snapshots disclose included and excluded reports and keep
currencies separate. Estimates describe the selected reported facts and local
quote; they are not bills or complete provider coverage. Current history exports
use schemaVersion 2 and retain these coverage limits. See the
[reported usage contract](docs/API.md#reported-usage-summaries-and-local-prices).
