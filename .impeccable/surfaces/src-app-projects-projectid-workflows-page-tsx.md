---
version: 1
slug: "src-app-projects-projectid-workflows-page-tsx"
primary_target: "src/app/projects/[projectId]/workflows/page.tsx"
related_targets: ["src/app/projects/[projectId]/tasks/[taskId]/page.tsx"]
---

# Project workflows

Mode: Operate. Planned W01–W02 v1 surface, not implemented. The operator expanded
v1 to include all phases on 2026-10-09. This view inherits the selected Work board
system from [DESIGN.md](../../DESIGN.md), including its lightly cartoonish paper
nodes and rounded text-labeled state markers.

## Job and structure

An engineer selects a workflow, immutable plan revision, and reported workflow
attempt, then traces branching work and opens a node's evidence. Project navigation
keeps Work board and Workflows as siblings. A graph/list toggle retains selection;
a toolbar holds selectors and zoom-to-fit. The evidence panel shows task/attempt
links, reported skill provenance, report time, readiness reasons, and review/rework
history with revision/artifact bindings.

Graph connectors describe reported plan ordering. Actual task prerequisites appear
as explicit readiness reasons; parent grouping never implies dependencies. Human
acceptance stays separate from reported success and review decisions.

## Required states

- Empty: explain how an external harness publishes a plan.
- Unknown node: no observation yet; never infer running or successful work.
- Fresh/stale workflow report, fresh/stale linked attempt, and browser connection
  each retain their own meaning and label.
- Historical revision and rework round: preserve old evidence, mark outdated
  approval applicability, and never retarget an approval to current work.
- Invalid report or missing reference: show the last committed snapshot; rejection
  belongs to ingestion evidence, not an invented node.
- Narrow/keyboard: equivalent list, full-page detail, focus restored to the selected
  node/list item after close, and no pointer-only control.

## Implementation proof

[V1_WORKFLOWS.md](../../docs/V1_WORKFLOWS.md) owns contracts and limits.
W01 proves real producer → database → graph/list across two browsers, selection
retention, 375 px, 200% zoom, and keyboard access. W02 proves dependency and rework
cases. W04 validates the integrated journey and load. Static design diagrams do
not satisfy these runtime gates. No execution controls belong in this surface.
