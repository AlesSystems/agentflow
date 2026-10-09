---
name: AgentFlow
description: A friendly work board with readable tasks and explicit human acceptance.
colors:
  canvas: "#f6f7f9"
  paper: "#fff"
  ink: "#202939"
  muted: "#526071"
  divider: "#cbd2dc"
  action: "#2457d6"
  backlog: "#e8edf4"
  progress: "#dcebff"
  review: "#ffe7a3"
  completed: "#ddf1df"
  attention: "#9b2c2c"
  attention-tint: "#fde8e7"
  rail: "#edf0f5"
  action-hover: "#1945b5"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "28px"
    fontWeight: 750
    lineHeight: "34px"
  section:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: "27px"
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: "21px"
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "17px"
rounded:
  small: "6px"
  notice: "8px"
  control: "10px"
  card: "12px"
  dialog: "16px"
  lane: "20px"
spacing:
  step-4: "4px"
  step-8: "8px"
  step-12: "12px"
  step-16: "16px"
  step-24: "24px"
  step-32: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px"
  task-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px"
  tag:
    backgroundColor: "{colors.backlog}"
    rounded: "{rounded.card}"
    padding: "3px 8px"
  accepted-stamp:
    backgroundColor: "{colors.completed}"
    rounded: "{rounded.small}"
    padding: "4px 8px"
---
# Design System: AgentFlow

## Overview

**Creative North Star: "The friendly work board"**

The implemented P03 system preserves the user's selected Work board (seed
`73cf6fb7`, pick) and its slightly cartoonish Fizzy-inspired direction. Original
paper cards, bold upright titles, colored lane capsules and small acceptance
stamps carry the character; evidence and recovery copy stay plain. Fizzy is a
reference, with no borrowed source, logos or assets.

This is a code-first extraction from `src/app/globals.css` and the implemented
shell, board, task, project and settings components on 2026-10-10. It describes
P03's manual workspace, not completion of v1. PRODUCT.md records the current package boundary; its observer, local-data,
offline-font and human-acceptance constraints still apply. P05 reporting and W01 graph surfaces remain planned.
No generated raster assets ship; review captures contain synthetic fixtures.

**Key Characteristics:**
- Title-first, aligned paper records with readable ink boundaries.
- One blue action accent and explicitly named lifecycle tints.
- Native fields, protected task dialogs and explicit recovery choices.
- Local system fonts and no decorative background noise.

## Colors

A cool neutral ground supports white records, dark ink, blue actions and gentle
status tints. The frontmatter preserves the actual CSS values.

### Primary
- **Action:** primary controls, links, focus outlines and insertion caret.
- **Action hover:** darker primary-button hover state.

### Secondary
- **Backlog:** neutral lane, tags, loading and acceptance-form ground.
- **Progress:** In progress lane, menu highlight and text selection.
- **Review:** Review lane and non-error notices.
- **Completed:** Completed lane and human-acceptance stamp.
- **Attention / attention tint:** urgent metadata, blockers and errors.

### Neutral
- **Canvas / Paper:** workspace ground and record/control surfaces.
- **Ink / Muted:** main text and secondary labels; muted remains readable metadata.
- **Divider / Rail:** separators, paper edge and navigation ground.

**The Written Status Rule.** A tint accompanies a written lifecycle label; a
blocker does not change the lane's meaning. Human acceptance and reported run
outcome remain separate facts.

## Typography

**Body Font:** system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif.
The same offline stack is used for headings and controls, honoring the pinned
system-font direction. There is no separate display or mono font token.

### Hierarchy
- **Headline:** page titles (750, 28px, 34px).
- **Section:** section headings (700, 20px, 27px); smaller headings use 17px/700.
- **Title:** task-card titles (700, 16px, 21px).
- **Body:** text and controls (400, 14px, 1.45; approximately 20.3px).
- **Label:** metadata (400, 12px, 17px); lane labels use body size at 700.

Brand text uses 22px/800. Dialog titles use 22px; primary buttons use 650.
Counts and Overview metrics use tabular numerals. Paragraphs have a 75ch maximum;
long titles and evidence wrap, and multiline evidence retains line breaks.

**The Title First Rule.** Keep card titles upright, wrapping and stronger than
metadata. Do not substitute a handwriting face or remote font.

## Layout

The desktop shell has a 192px rail and a flexible main area with 28px vertical
and 24px horizontal insets. Four lanes use `minmax(240px, 1fr)` with 16px gaps.
Cards have 16px padding and 12px vertical gaps. Forms and action groups wrap;
paired fields use two equal columns with a 12px gap. Recurring spacing uses the
frontmatter scale, while controls also use measured 6px/10px/14px insets.

At `max-width: 1247px`, the board displays only the selected status lane with a
labeled selector (maximum width 400px). The task panel becomes 100vw, square
cornered and 100dvh tall, retaining its protected modal interaction and mounted
board context. At `max-width: 700px`, navigation wraps above the content, main
insets become 24px/16px, paired fields stack and dialog padding becomes 16px.
An in-board desktop task panel is 440px wide and right anchored; ordinary dialogs
are at most 600px wide with 16px viewport clearance and scrollable content.
Direct task routes use a 760px maximum content width and Back to work board.
Settings sections are at most 700px wide and timezone fields at most 400px.

The existing finish review reports loaded 1440px desktop and 375×812 narrow
captures and native Chrome 200% zoom: 1440/DPR1 became 720/DPR2 while CSS zoom
remained 1. This is existing P03 evidence, not a new documenter test or proof of
every later repair. The finish review and final coordinator gates own acceptance.

## Elevation & Depth

Thin ink outlines define records. The selected cartoon paper world uses a small
structural paper edge, without diffuse shadows on ordinary cards. Menus and
dialogs receive soft elevation over a translucent ink scrim.

### Shadow Vocabulary
- **Paper edge** (`0 2px 0 var(--divider)`): resting task cards.
- **Dialog** (`0 12px 38px rgb(32 41 57 / 0.2)`): task and ordinary dialogs.
- **Menu** (`0 8px 20px rgb(32 41 57 / 0.15)`): status dropdown.

**The Paper Edge Rule.** Preserve the chosen small paper edge; do not combine it
with a diffuse card shadow or turn it into an exaggerated offset effect.

## Shapes

Cards, empty lanes and acceptance sections use 12px corners. Fields and buttons
use 10px; dialogs use 16px; lane capsules use 20px. Tags use 12px corners,
acceptance stamps 6px, and blockers 8px. Cards and lane capsules have 1px ink
borders; inputs use 1px muted borders. The acceptance stamp contains the words
“Human accepted”; the implemented stamp has no outlined check icon.

## Components

### Buttons
Readable, lightly rounded controls use 10px/14px padding and a 42px minimum
height. Primary actions use blue/white and weight 650; secondary actions use
paper/ink, Backlog hover and Progress active fill. Card move buttons are smaller
(36px minimum height, 6px/10px padding). Disabled controls use opacity 0.65.
Focus-visible is a 3px Action outline with 3px offset. No general hover motion
or hover lift is implemented.

### Chips and lane tabs
Tags use neutral Backlog fill, 12px text and 3px/8px padding. Lane capsules use
written status, inline count, 8px/14px padding and a 12px internal gap. Counts
represent all matching tasks rather than only loaded records.

### Cards and task records
White outlined records hold title, priority, optional target role/assignment UUID,
blocker and tags. Cards do not carry latest-run data in their list DTO. Completed
cards show “Human accepted” from authoritative lifecycle status. Detail shows
actual latest-run facts when present, current completion evidence and independently
paged acceptance/reopen histories; no timeline, inferred execution status or
per-card run-fetch fan-out is implemented.

### Inputs and recovery
Labeled native inputs/selects/textarea use 10px padding, 42px minimum height and
visible blue focus. Task text fields point to shared task-form feedback; validation
uses native constraints plus schema messages. Errors and refresh failures retain
existing data, with explicit retry. Version conflict exposes current saved values
beside the retained draft: Prepare reapply establishes the new base for inspection,
then Save submits; discard/reload requires confirmation. No automatic merge occurs.

### Navigation and protected detail
Navigation exposes Overview, Projects and Settings, with browser sign-out.
Radix modal dialogs provide named focus containment and background protection;
the board restores focus to a visible task title, prior trigger or Create task.
Closing after movement selects the current narrow-screen lane. URL-addressable
selection retains board filters; direct routes provide a board-return control.
Dirty close offers Stay or Discard and leave. Dirty link/reload navigation also
uses browser confirmation. Memory drafts survive mounted refresh/failure and
in-app pairing repair; full reload loses them, as the pairing dialog discloses.

### Lifecycle and action feedback
Status menus provide the keyboard movement path; dragging has a dedicated SVG
handle, 8px activation distance, clone feedback and no drop animation. Both use
the same move intent. Completed movement from Backlog/In progress explains Move
to Review first. From Review it opens evidence entry; only a committed human
completion produces acceptance. Archived tasks are read-only; Completed fields
require Reopen with a reason. Dirty task fields disable lifecycle/comment actions
and completion while retaining evidence/reopen/comment notes. Acceptance guidance
remains visible when a refreshed task is no longer in Review; its submit is gated.
AgentFlow observes external execution and provides no launch/stop controls.

Only the dialog scrim animates (`fade-in`, 150ms ease-out, opacity 0.6 to 1).
Reduced motion disables animation and transitions and uses auto scrolling.
Updates do not animate a heartbeat or imply process liveness.

## Do's and Don'ts

### Do:
- **Do** preserve local fonts/assets, explicit status text and visible focus.
- **Do** keep human acceptance separate from reported execution success.
- **Do** retain drafts through failure and require an explicit conflict decision.
- **Do** adapt to one selected lane and readable full-viewport task controls.

### Don't:
- **Don't** borrow Fizzy assets or add mascots, confetti or ambient motion.
- **Don't** invent card report data, liveness, graph nodes or execution controls.
- **Don't** describe synthetic browser acceptance as a human attestation.
- **Don't** treat captures or sampled contrast as a blanket WCAG 2.2 AA claim.

The finish review reports keyboard/focus/recovery journeys, axe checks, text/action/
lane contrast above 4.5:1 and reduced-motion evidence for its frozen candidate
(runtime `23e1ac0`, documentation `d1e498d`). Scoped acceptance-guidance review at `0cc8dab` scored its repairs resolved.
Final exact-candidate code review and integration remain coordinator gates.
No historical QUALITY BAR card was supplied, and none is invented here. Direct route entry focuses its task heading once per task identifier; later
background refresh does not steal editor focus. Shared rather than per-field
schema feedback and the small title-button hit area remain limitations to assess
as the system expands, not patterns to canonize.
