# AgentFlow

AgentFlow is a planned local application for engineering tasks, agent activity, and review progress. It combines a simple Kanban board with execution history from your existing agent harness.

**Status: design only.** This repository contains the architecture and delivery plan. There is no runnable application yet. The commands and API examples in the documents describe the implementation target.

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
| [Design seed](DESIGN.md) | Lightly cartoonish Work board direction and proposed visual values |
| [Board surface brief](.impeccable/surfaces/src-app-projects-projectid-page-tsx.md) | First board composition, states, and P03 acceptance targets |
| [Work board design brief](docs/design/WORK_BOARD.md) | Static visual studies, evidence hierarchy, and v0.1 tracking scope |
| [Roadmap](ROADMAP.md) | Product milestones, release boundaries, and exit criteria |
| [Implementation plan](PLAN.md) | Ordered work packages and verification requirements |
| [Execution policy](docs/EXECUTION_POLICY.md) | Approved v0.1 delivery authority, review gates, and future-run prompt |
| [Architecture](docs/ARCHITECTURE.md) | System boundaries, stack, and proposed source layout |
| [Backend](docs/BACKEND.md) | Domain model, persistence, state transitions, and recovery |
| [Frontend](docs/FRONTEND.md) | Pages, interactions, accessibility, and live updates |
| [API](docs/API.md) | Versioned HTTP contract, execution events, and CLI behavior |
| [Decisions](docs/DECISIONS.md) | Accepted choices, alternatives, and remaining evidence gaps |

Impeccable initialization records the existing product plan and a code-first
workflow in `.impeccable/config.json`. The design seed does not implement P03.
After the UI exists, run `$impeccable document` to extract real tokens and generate
the design sidecar; browser verification is still required by the plan.

## Local runtime target

After implementation, `npm run dev` starts development mode and `npm run build` followed by `npm start` starts the production build. Both bind to `127.0.0.1:3000`. The browser opens `http://localhost:3000`.

The app requires no cloud account, hosted database, Docker, or paid infrastructure. Package installation requires network access. Agent providers used by an external harness may have their own network requirements and costs.

Runtime data stays outside the checkout. A public source repository does not publish the local database or agent history. No telemetry, remote fonts, or external asset requests are part of the product design.

## Current delivery boundary

The first release combines the foundation and agent-integration milestones. Workflow graphs, dependency enforcement, GitHub synchronization, usage analytics, and agent controls are later work. See the [roadmap](ROADMAP.md).

AgentFlow-owned material is licensed under [MIT](LICENSE), copyright 2026 AlesSystems. Retain applicable third-party licenses and notices.

The operator approved the [execution policy](docs/EXECUTION_POLICY.md) for a future v0.1 implementation run. It permits verified package merges and source release without repeated operator sign-off. Its final section contains the activation prompt. Implementation remains unstarted.
