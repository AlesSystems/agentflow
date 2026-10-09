---
version: 1
slug: "src-app-projects-projectid-page-tsx"
primary_target: "src/app/projects/[projectId]/page.tsx"
related_targets: ["src/app/projects/[projectId]/tasks/[taskId]/page.tsx"]
---

# Project board

## Scope

Mode: Operate. P03 implements the manual Work board and shared addressable task
record, alongside Overview, project management and Settings. This brief records
the implemented candidate; final package acceptance/integration remains subject
to the execution policy and coordinator gates. P05 report tracking and W01
workflow graph/list remain planned. AgentFlow observes external execution.

## Task and content

An engineer scans stored tasks, opens a record, edits work, inspects evidence and
records human acceptance of its current work revision. Operator data is real;
review fixtures and browser acceptance are synthetic and never human attestations.
Domain/API responses remain authoritative. No automatic demonstration data ships.

## Direction contract

**THESIS:** A friendly Kanban work board keeps task titles and their evidence
readable, with a little cartoon character in lane tabs and controls.

**OWN-WORLD:** Light paper cards, bold system-sans titles, rounded colored lane
tabs, restrained ink outlines, one blue action accent and human-acceptance stamps.

**STORY:** Scan work, inspect evidence and record human acceptance. P03's manual
movement reaches Review before acceptance reaches Completed; successful external
implementation runs and expanded reporting remain the later reporting contract.

**FIRST VIEWPORT:** Compact navigation at left; project title, Create task and
filters above four equal desktop lanes: Backlog, In progress, Review, Completed.
Titles dominate cards; counts belong beside lane headings. Selecting a card opens
its record beside the board and retains filter context.

**FORM:** User-selected original Work board, refined toward Fizzy with a slightly
cartoonish character on 2026-10-09. Seed `73cf6fb7`; choice kind `pick`; code-first
build. The P03 implementation realizes this selected world, with no borrowed
source/assets and no generated shipping raster assets.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

The independent UI finish review has disposition ship for its frozen candidate;
DESIGN.md and the schemaVersion 2 sidecar now extract actual code. Subsequent
correctness repairs require final scoped review and coordinator verification.

## Signature interaction

In-board selection uses a URL-addressable Radix task dialog, 440px wide on desktop.
Below 1248px it fills the viewport and protects focus while preserving the mounted
board/draft context. Direct task navigation uses the same detail content with a
Back to work board control and the normalized original filters. At 700px and
below, navigation wraps above content and fields stack with 16px horizontal insets.

Dialog close restores the visible task-title trigger, prior visible trigger or
Create task. After movement, the narrow board selects the task's current lane.
Dirty close/back offers Stay or explicit discard; dirty links/reload use browser
confirmation. Full reload loses memory drafts, disclosed by in-app re-pairing.
Direct-route entry focuses its task heading once per task identifier, including
narrow reloads, and does not steal editor focus during background refresh.

## Implemented states and boundaries

- Create task defaults to authoritative Backlog. Empty lanes explain their state;
  filtered empty lanes point to Clear filters. Counts cover all matching tasks,
  with 50 initially loaded per lane and explicit Load more/error retry.
- Filters persist normalized search, priority, tag and assigned-agent UUID in the
  URL. Cards show title, priority, optional role/assignment UUID, blocker and tags.
  The board list DTO has no latest-run or completion object; no run N+1 fetches,
  guessed “No reports”, inferred execution status or report timeline are added.
- Keyboard status menus and pointer lane drops use the same movement intent.
  Dedicated SVG drag handles activate after 8px movement; cancelled/same-lane
  movement issues no command. Completed movement requires Review first, then
  opens acceptance without moving the authoritative card before commit.
- Detail shows real latestRun when present, current completion/evidence and
  independently paginated acceptance/reopen history; comments page separately.
  There is no agent execution control, graph, Agents or Activity navigation yet.
- Archived projects/tasks are read-only. Completed fields require Reopen with a
  reason. Human completion requires the current Review record and evidence note;
  run/revision gates remain server enforced. Lifecycle and comment actions are
  gated while a task-field draft exists; notes are retained during refresh/failure.
  If refreshed status leaves Review, acceptance guidance remains visible and its
  submit is disabled. The scoped review scored this guidance resolved at `0cc8dab`.
- Conflict presents current saved values beside retained input. Prepare reapply
  selects the current base for inspection before Save; discard/reload confirms
  draft loss. Exact retries preserve frozen request/key after uncertain response.
  Background refresh does not replace an active field draft or retained notes.
- Query failure retains existing data and offers retry. Re-pairing stays in-app to
  keep mounted drafts. P03 has no subscription/connectivity or agent-freshness
  banner and makes no live-report claim; those richer states belong to P05.
- Settings exposes server timezone, observational storage and pairing/sign-out.
  Overview and project lists use stored records; no invented activity feed ships.

## Evidence and limits

The independent P03 Impeccable finish review records five valid loaded captures
(board, task-panel, conflict, narrow, settings), plus a corrected 375×812 narrow
task viewport. It inspected runtime `23e1ac0aef269f1c1d8897ea2426436fafbf53ff`
through documentation candidate `d1e498d2378875dc92c8dcb6c1db1e32d3a97446`.
It reports 16 production-browser passes, native Chrome 200% zoom (1440/DPR1 to
720/DPR2, CSS zoom 1), text/action/lane contrast above 4.5:1, reduced-motion
behavior and an empty detector result. The recording was sampled, not fully
played by the reviewer. No historical QUALITY BAR card was supplied.

This extraction reflects committed runtime source
`7dbc8b76bc36c2d19a88ad550216a38af0a4656d`;
it does not claim the older captures depict those repairs or rerun any UI check.
Coordinator reports five targeted regressions passing; the scoped acceptance-guidance review scored its states resolved; final
exact-candidate code review and integration remain separate gates. CSS
still implements the selected system unchanged: 192px rail, 240px minimum lanes,
16px lane gaps, 1247px single-lane breakpoint, 700px stacked-shell breakpoint,
440px desktop detail and 150ms scrim fade disabled under reduced motion.

Source identities for this extraction:

- `src/app/globals.css`: SHA-256 `d4b69a972fa7d9bd51ae6b0492e31e253a16f736a689184701a770b52464592f`.
- `src/components/board/board.tsx`: SHA-256 `27f578f8821fb96cc0ed91f53bc654b09901c76ffaaddb0ce8ff8aa11711ee79`.
- `src/components/tasks/detail.tsx`: SHA-256 `b9a438fa131376f003e09a877823fcbda0f8dcff5fe421aca86bdf6830e3ea7a`.
- `src/components/tasks/page.tsx`: SHA-256 `13484f507df6b6ce1f86876ecd6abd00baa4679f8976eb6df19596230088367b`.
- `src/app/projects/[projectId]/tasks/[taskId]/page.tsx`: SHA-256 `9a595388ee93e479622c3615d3d0629a8f99a65935f0ea443322b26e15d3fd82`.

[DESIGN.md](../../DESIGN.md) contains actual tokens and component rules;
[the design brief](../../docs/design/WORK_BOARD.md) retains static studies and
future tracking scope. No blanket WCAG 2.2 AA compliance is claimed. Shared
schema feedback and the small title-button target remain limitations to assess
rather than canonize. PRODUCT.md now records the implemented package boundary.
