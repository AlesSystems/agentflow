---
name: AgentFlow
description: A lightly cartoonish work board with clear tasks and reported evidence.
---

# Design System: AgentFlow

Status: proposed design specification, updated 2026-10-09. No application UI has
been implemented. Values below are design targets, not extracted runtime tokens.

## Direction

**The friendly work board.** Preserve the selected Work board's classic Kanban
composition. Give it a little cartoon character through bold titles, rounded
status tabs, ink-like outlines, and small acceptance stamps. An engineer checking
local work during a busy day should find the next task before noticing decoration.

The user selected the Work board prototype and requested a slightly cartoonish
[Fizzy-like direction](https://www.fizzy.do/). Its published board image informs
the confident typography, colored lane markers, and paper-card feel. AgentFlow
uses original shapes, copy, and layouts; no Fizzy source, logos, avatars, or other
assets are included. See the [design brief and static studies](docs/design/WORK_BOARD.md).

Keep expression concentrated in lane headers, controls, and recorded acceptance.
Body text, timestamps, failures, and evidence remain plain and precise. Cards
stay aligned and text stays upright. No mascots, confetti, ambient bouncing,
handwritten body font, or decorative noise behind records.

## Proposed palette

| Role | Value | Use |
| --- | --- | --- |
| Canvas | `#F6F7F9` | Light cool workspace |
| Paper | `#FFFFFF` | Cards, fields, detail surface |
| Ink | `#202939` | Titles, body text, strong outlines |
| Muted ink | `#526071` | Secondary labels and timestamps |
| Divider | `#CBD2DC` | Nonessential separators |
| Action | `#2457D6` | Primary button, links, selection, focus |
| Backlog tint | `#E8EDF4` | Neutral lane label |
| In progress tint | `#DCEBFF` | Blue lane label |
| Review tint | `#FFE7A3` | Warm lane label |
| Completed tint | `#DDF1DF` | Green lane label |
| Attention ink / tint | `#9B2C2C` / `#FDE8E7` | Failed report or blocker |

Use Ink on every lane tint. Use white on Action for primary buttons. Tints never
carry meaning without a written status; failure and stale reporting never recolor
the task's lifecycle lane. Muted ink is for readable metadata, not disabled text.
Validate actual contrast pairs and focus boundaries during P03.

## Type, spacing, and shape

Use `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` without
network font requests. Page titles start at 28/34 px, weight 750; card titles at
16/21 px, weight 700; body and controls at 14/20 px; metadata at 12/17 px minimum.
Use tabular numerals for counts and times. Let long titles wrap; truncate optional
summaries only, with full content available in the detail view.

Use a 4, 8, 12, 16, 24, 32 px spacing scale. Start with 16 px card padding,
16 px lane gaps, and a 24 px content inset. Card radius: 12 px. Field and button
radius: 10 px. Lane labels and tags may use capsules. Card boundaries use 1 px
neutral ink; selected cards and emphasized controls use 2 px Ink or Action.
A small 0 2 px 0 neutral offset may give cards paper depth. Overlays use one
soft shadow. Do not stack offset and diffuse shadows on ordinary cards.

The acceptance stamp is an outlined check and the words “Human accepted”, with
its timestamp in the evidence record. A successful run gets “Succeeded” and a
separate “Awaiting human review” label, never this stamp.

## Layout and motion

Keep compact navigation, project title and Create task, filters, then four lanes:
Backlog, In progress, Review, Completed. The board remains the main work area.
Tracking is available in task detail, Agents, Activity, and Overview; graphs do
not replace the board. See the [surface brief](.impeccable/surfaces/src-app-projects-projectid-page-tsx.md).

Desktop planning target: 192 px navigation, four flexible lanes of at least
240 px, and a 440 px detail overlay with constrained width. Below the width that
fits these lanes, show a status selector and one lane. At 375 px use 16 px page
insets and full-page task detail. These dimensions are starting targets; content,
200% zoom, and actual focus behavior decide final breakpoints during P03.

Use 120–180 ms opacity or short position transitions only for opening, closing,
and committed movement. Reduced motion removes translation. A report update
must not move focus, collapse a disclosure, discard a draft, or animate a heartbeat.

## Evidence and constraints

Static studies illustrate composition with synthetic data; they do not prove
responsive behavior, accessibility, interaction, or persistence. P03 and P05 must
verify keyboard and pointer journeys, 375 px layout, 200% zoom, contrast, focus
restoration, retained drafts, and recovery states. Preserve local-only assets,
explicit freshness, browser connectivity, and human-only completion.

After implementation, run `$impeccable document` to describe actual tokens and
components and generate `.impeccable/design.json`. Do not present these proposed
values as measurements of a shipped interface.
