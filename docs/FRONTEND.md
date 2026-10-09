# Frontend architecture

Status: design specification. No screens have been implemented or visually verified.

## Information architecture

Navigation contains Overview, Projects, Agents, Activity, and Settings. A task opens in a shared detail panel with a stable URL. The board is the primary work area; Overview summarizes attention rather than becoming a wall of charts.

| Route | Main content |
| --- | --- |
| `/` | Counts, tasks awaiting review, stale or failed runs, recent activity |
| `/projects` | Project list, create action, archive filter |
| `/projects/[projectId]` | Backlog, In progress, Review, Completed board |
| `/projects/[projectId]/tasks/[taskId]` | Addressable task detail, presented as a panel from its board |
| `/agents` | Agent identity, role, active reported runs, freshness, latest outcome |
| `/agents/[agentId]` | Run history and linked tasks |
| `/activity` | Paginated events filtered by project, agent, or task |
| `/settings` | Pairing state, timezone, data location, storage size, backup instructions |
| `/login` | Local token pairing and session-expiry recovery |

Use the same task detail component for direct navigation and panel navigation. Back returns to the previous board filters. A narrow screen uses a full-page task view and a status selector instead of squeezing four columns together.

## Board and task interactions

A card shows its title, priority, assigned role or agent, latest run outcome, and any blocker. A detail panel contains description, acceptance criteria, comments, repository links, run history, and completion evidence.

Create requires a project and title. Other fields are optional. Fixed columns avoid a workflow editor in the first release. Search, tag, priority, and assigned-agent filters live in the URL. Server-side counts include every matching task, including unloaded pages. Each column initially loads 50 cards with a load-more control.

A status menu is the complete keyboard-accessible way to move a card. Drag-and-drop invokes the same command. Dropping into Completed opens the human acceptance form and does not optimistically complete the task. If domain rules reject a move, the card remains in its authoritative column and the UI explains the reason.

The first release sorts each column by creation time, newest first. Dragging changes columns only. Manual ordering and rank renumbering are deferred. Completed tasks require Reopen before editing. Opening a task shows which action requires attention without hiding failed attempts.

An implementation run that succeeds places its task in Review. A human reads the available evidence, enters an acceptance note, and chooses Complete. AgentFlow labels that evidence as human-recorded. Review and verification reports remain distinguishable from that acceptance.

## Visual direction

The user selected the Work board prototype and requested a slightly cartoonish,
Fizzy-like refinement on 2026-10-09. [DESIGN.md](../DESIGN.md) records proposed
palette, typography, shape, and motion targets. The
[Work board design brief](design/WORK_BOARD.md) includes static desktop/narrow
studies and tracking-component scope; the
[board surface brief](../.impeccable/surfaces/src-app-projects-projectid-page-tsx.md)
records composition and states. Values remain unverified until P03 implementation.

Use light paper surfaces, bold readable card titles, rounded colored lane tabs,
and restrained outlines. Keep technical evidence plain and human acceptance
explicit. One blue action accent is separate from labeled lifecycle colors.
System fonts and original local assets preserve offline use. Fizzy informs the
lightness and character; no source or assets are reused.

v0.1 tracking uses status counts, attempt timelines, freshness labels, and
attention/activity lists in P05. Timelines display ordered reports rather than
inferred stages or percent complete. Connected workflow graphs remain W01;
no workflow tab or graph dependency is added to v0.1 by this design proposal.

Use selected shadcn/ui controls for dialogs, menus, fields, and focus behavior, then verify the actual combinations. Library defaults are not evidence that a complete interaction is accessible. The implementation includes a documented visual review of the board, task panel, failure state, and narrow layout.

## Server and client responsibilities

Server Components render authenticated initial queries and the page shell. Client components own form drafts, board interaction, filters, and the SSE subscription. Shared contracts define data shapes. Only the server accepts or rejects lifecycle changes.

Use one client query cache, proposed as TanStack Query, for board and detail data after hydration. No separate global state store is needed. Draft form state stays local to its component. URL state owns navigation and filters.

A successful command returns committed data and its cursor. The client invalidates affected queries and refetches authoritative records, including related counts. Optional cache updates from a response must never replace a newer entity version. A retried command can return an older stored receipt. Mutation replies never advance the SSE cursor. A changed `AgentFlow-Generation` header discards the prior snapshot and subscription before a fresh load. Version conflicts retain the user's draft, show the current record, and offer an explicit reload/reapply path. The client never silently overwrites another actor's changes.

SSE invalidates queries by entity. It is not a second copy of the domain reducer. Duplicated notifications are harmless. An event arriving during a save is followed by an authoritative refetch. Reconnection and reset use a fresh snapshot and stream cursor as specified in [API.md](API.md).

## Freshness and failure states

While a page is visible, refetch freshness-dependent queries and Overview every 15 seconds even when SSE is healthy. Refresh immediately on tab focus and on a timezone change. This covers heartbeat silence and local-day rollover without a database write. Relative timestamps may tick locally, but the API remains authoritative for counts. The 60-second stale boundary must appear within 15 further seconds on a connected visible page.

The browser's connection to AgentFlow and an agent's reporting freshness are separate indicators. A connected browser can still show a stale run. Agent rows use phrases such as "Running, last report 8 seconds ago" and "Last reported running, 4 minutes ago". There is no unqualified Online label.

When SSE is disconnected, show the last update time and keep existing data. Refetch every five seconds while the page is visible, with backoff after failures. Resume SSE with its last applied cursor. Authentication failure stops retries and opens pairing without discarding the in-memory draft.

A failed save preserves entered text and offers retry. A conflict explains which data changed. Disk-full and database-busy errors show a repair or retry action. The UI never displays a successful save before the server commits it.

Empty projects offer Create project. Empty boards offer Create task. Empty Agents explains that an integration must send reports. Filtered empty results offer Clear filters. Demonstration data is opt-in, clearly marked, and stored in a separate demo data directory.

## Metric definitions

The API computes all Overview metrics from one snapshot. "Today" uses the operator's selected IANA timezone, initialized from the browser and stored locally. Boundaries are converted to UTC with daylight-saving rules. No timezone is inferred from repository or machine names.

| Label | Definition |
| --- | --- |
| Active projects | Unarchived projects |
| Reporting agents | Distinct agents with a `running` run and a report within 60 seconds |
| Completed today | Distinct currently completed tasks whose current human acceptance occurred today |
| Awaiting review | Unarchived-project tasks in `review` |
| Failed runs today | Runs with outcome `failed` and terminal server receipt time today |
| Needs attention | Failed or stale runs and tasks with a nonempty blocker; grouped to avoid duplicate cards |

Agent and task metrics exclude archived projects. Active workflows is absent until a workflow model exists. Usage is unknown when the harness does not report it; it is never displayed as zero. Cost estimates are deferred.

## Accessibility acceptance

The complete create, edit, move, inspect, accept, and reopen journey must work without a pointer. Focus enters the task panel and returns to its triggering card. Closing a dirty panel preserves the draft or prompts before discarding it. Dialogs expose accessible names and errors are associated with fields.

Status labels do not rely on color. Target WCAG 2.2 AA contrast and keyboard behavior, verified during P03 and P07. Respect reduced motion and avoid animated card motion when disabled. Announce saves, errors, and moves without narrating every heartbeat. Check at 200% zoom and a 375 px viewport.
