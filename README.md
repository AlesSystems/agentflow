# AgentFlow

AgentFlow is a local application for engineering tasks, agent activity, and review progress. It combines a simple Kanban board with execution history from your existing agent harness.

**Status: P01–P04 integrated; manual Work board and reporting APIs available.** Pairing, projects/tasks, comments, acceptance/reopen, backup and restore are runnable. Live tracking, CLI hooks and workflow packages remain gated by PLAN.md.

## Product direction

- Build an original application with Next.js, React, TypeScript, and SQLite.
- Manage projects and tasks. Observe agents through explicit reports from their harness.
- Start with a common local HTTP API and CLI hooks.
- Keep the application, database, and execution history on the user's machine.

An implementation run that succeeds moves its task to Review. Completed means a human has recorded acceptance evidence. AgentFlow does not launch agents, execute tests, or infer what unintegrated agents are doing.

The interaction goal is the lightweight board experience of [Fizzy](https://github.com/basecamp/fizzy), with an original implementation and visual design. No Fizzy source or assets are included.

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

Stop the service before maintenance:

```sh
npm run local -- credentials rotate
npm run local -- backup --output /absolute/protected/backups/snapshot.sqlite
npm run local -- restore --from /absolute/protected/backups/snapshot.sqlite
```

Backup refuses an existing destination. Restore verifies the backup, preserves the current database/WAL/SHM in a damaged bundle, replaces the database, changes its generation, and revokes every browser session. Credentials stay in the current external `credentials.json`; backups exclude them. Later observations absent from the backup cannot be recovered by restore. Never copy a live main SQLite file alone.

An interrupted restore refuses startup. Run `npm run local -- restore repair` while stopped to finish the recorded replacement. Preserve the marker and damaged bundle if repair fails. Do not delete the database or lock file to make startup succeed.

Verify with `npm run test:unit`, `npm run test:integration`, `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`. Install the default test browser with `npx playwright install chromium`. On a host with supported Google Chrome installed, `AGENTFLOW_TEST_BROWSER=chrome npm run test:e2e` uses a fresh Playwright profile. It does not use your personal browser profile. [P01 evidence](docs/implementation/P01.md) records the exact tested configuration and limitations.

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
