---
version: 1
slug: "src-app-projects-projectid-page-tsx"
primary_target: "src/app/projects/[projectId]/page.tsx"
related_targets: ["src/app/projects/[projectId]/tasks/[taskId]/page.tsx"]
---

# Project board

## Scope

Mode: Operate. Primary target: `src/app/projects/[projectId]/page.tsx` (planned,
not implemented). Related target: the addressable task detail route.
This brief supports P03 in [PLAN.md](../../PLAN.md); it does not start implementation.

## Task and content

An engineer scans a project's work, opens a task, inspects its reported attempts,
and records acceptance when the current revision qualifies. Use actual stored
project and task content. Synthetic demonstration data must be labeled and opt-in.
Domain rules and authoritative responses remain as defined in the frontend/API plans.

## Direction contract

**THESIS:** A friendly Kanban work board keeps task titles and their evidence
readable, with a little cartoon character in lane tabs and controls.

**OWN-WORLD:** Light paper cards, bold system-sans titles, rounded colored lane
tabs, restrained ink outlines, one blue action accent, and human-acceptance stamps.

**STORY:** Scan work, inspect a reported attempt, read evidence, and record human
acceptance. A successful implementation reaches Review; acceptance reaches Completed.

**FIRST VIEWPORT:** Compact navigation rail at left; project title, Create task,
and filters above four equal lanes: Backlog, In progress, Review, Completed.
Titles dominate cards; counts belong beside lane headings. Selecting a card opens
its evidence panel beside the board and retains the board's filter context.

**FORM:** User-selected Work board, refined toward Fizzy with a slightly cartoonish
character on 2026-10-09. This explicit refinement supersedes the earlier issue-ledger
material treatment while preserving its composition. Original seed: `73cf6fb7`;
choice kind: `pick`. Build path remains code-first. This delivery is documentation.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

This is a seed-only delivery. The FINISH line above applies to the future UI build;
this PR's gate is documentation consistency and independent review.

## Signature interaction

Selecting a card opens a URL-addressable task record with attempts and acceptance
evidence. Closing restores focus to the card and the prior filters. Direct links
use the same detail view. The signature is preserved context and visible evidence,
not a decorative transition. Narrow screens use a full-page detail view.

## Required states

- Empty board: Create task. Filtered empty result: Clear filters.
- Cards: title, priority, assignment, latest run outcome, and blocker when present.
- Status menu provides the full keyboard move flow; dragging uses the same command.
- Completed move opens the human acceptance form and waits for a committed result.
- Browser disconnection retains data and labels the last update time; stale agent
  reports carry their own explicit freshness label.
- Save failure retains text; conflict retains the draft and offers reload/reapply.
- Completed tasks require Reopen before editing. Counts cover all matching tasks;
  columns initially load 50 records with Load more, newest first.

## Implementation acceptance and open decisions

P03 must verify create, edit, move, inspect, accept, and reopen using keyboard and
pointer; focus restoration, dirty drafts, errors, reduced motion, 200% zoom, and
375 px layout. Inspect desktop board, detail, failed/conflicting save, and narrow
layout together. Screenshots and browser evidence belong to that implementation PR.

[DESIGN.md](../../DESIGN.md) now proposes visual values and starting dimensions.
The [design brief](../../docs/design/WORK_BOARD.md) supplies static studies and
tracking scope: event timelines in P05, workflow graph in v1 W01. Final
breakpoints and control-library combinations require runtime validation. No
application UI or accessibility pass is claimed.
