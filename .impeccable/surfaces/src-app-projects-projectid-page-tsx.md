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
to the execution policy and coordinator gates. P05 tracking is implemented in the candidate; W01 workflow graph/list remains
planned. P05 package verification and integration remain open. AgentFlow observes external execution.

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
movement reaches Review before acceptance reaches Completed; successful external implementation runs reach Review under P04, while P05
shows received facts and uncertainty separately from human acceptance.

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
  The board carries a bounded latest-attempt summary with written freshness,
  identity/model or “No registered attempts”; there is no run N+1 fetch or
  inferred process liveness.
- Keyboard status menus and pointer lane drops use the same movement intent.
  Dedicated SVG drag handles activate after 8px movement; cancelled/same-lane
  movement issues no command. Completed movement requires Review first, then
  opens acceptance without moving the authoritative card before commit.
- Detail shows real latestRun when present, current completion/evidence and
  independently paginated acceptance/reopen history; comments page separately.
  P05 adds Reported attempts after the independent histories, with selected
  detail detached from its list row. Agents and Activity are in navigation;
  no agent execution control or graph is implemented.
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
  keep mounted drafts. P05 adds the shared browser connection strip and reported freshness labels.
  Browser connectivity never implies an external process is alive.
- Settings exposes server timezone, observational storage and pairing/sign-out.
  Overview and project lists use stored records; Activity displays real stored report/closure records, excluding heartbeat noise.

## Evidence and limits

The independent P03 Impeccable finish review records five valid loaded captures
(board, task-panel, conflict, narrow, settings), plus a corrected 375×812 narrow
task viewport. It inspected runtime `23e1ac0aef269f1c1d8897ea2426436fafbf53ff`
through documentation candidate `d1e498d2378875dc92c8dcb6c1db1e32d3a97446`.
It reports 16 production-browser passes, native Chrome 200% zoom (1440/DPR1 to
720/DPR2, CSS zoom 1), text/action/lane contrast above 4.5:1, reduced-motion
behavior and an empty detector result. The recording was sampled, not fully
played by the reviewer. No historical QUALITY BAR card was supplied.

This extraction reflects source `279ef6313a7d7cbbd9e0b55ba9323d7a7ca6cdf5`.
The P05 finish review scored its two ordered fixes resolved and returned ship;
this does not approve the whole package or integration. The documenter reran no
UI checks. Long unbroken identities wrap in run headings and card metadata.
Source identities:

- `src/app/globals.css`: SHA-256 `4f287281e9530128a082d423f8acf69b8ccfa012a326ea1a03390973341a263e`.
- `src/components/board/board.tsx`: SHA-256 `a9ed464d86a0f67b7abad8d0e2134c411a7e0de221f5f07f321dce633a532c84`.
- `src/components/tasks/detail.tsx`: SHA-256 `e47116bb627dd71685e873f28f060348d55a20c6bdc0a39d58280d4ccf233a2b`.
- `src/components/tracking.tsx`: SHA-256 `53652452a4fe37abfb14fadc5b2f2bbd1d6e3c7c6f4409da634fb158c6b04db4`.
- `src/components/connection.tsx`: SHA-256 `530f7224de78620a3a8dd955694050418ebbdbcfb4749f3e37d0d7afcd2c5701`.

[DESIGN.md](../../DESIGN.md) contains actual tokens and component rules;
[the design brief](../../docs/design/WORK_BOARD.md) retains static studies and
historical tracking studies. No blanket WCAG 2.2 AA compliance is claimed. Shared
schema feedback and the small title-button target remain limitations to assess
rather than canonize. PRODUCT.md now records the implemented package boundary.
