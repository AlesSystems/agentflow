---
name: AgentFlow
description: A sketchbook work board in graphite and clay, with readable evidence and explicit human acceptance.
colors:
  paper: "#fbf7ee"
  paper-dot: "#e2d8c5"
  card: "#fffdf7"
  surface: "#fff"
  ink: "#2b2722"
  graphite: "#5e5a54"
  placeholder: "#6f6a62"
  pencil: "#8c857a"
  rule: "#cfc4b2"
  faint: "#efeae0"
  clay: "#b4472a"
  clay-hi: "#bd4e2b"
  clay-lo: "#a33f24"
  clay-deep: "#93371f"
  clay-tint: "#f6e1d6"
  backlog: "#dfe7f0"
  backlog-ink: "#33465e"
  progress: "#fbe6b0"
  progress-ink: "#6e4a00"
  review: "#e9e0f6"
  review-ink: "#58378a"
  completed: "#dcebd3"
  completed-ink: "#2d5e2f"
  attention: "#a8241c"
  attention-tint: "#fbe2dd"
  stale: "#fff1c9"
  stale-ink: "#6b4f00"
typography:
  display:
    fontFamily: "Kalam, cursive"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1.12
  sheet:
    fontFamily: "Kalam, cursive"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.12
  section:
    fontFamily: "Kalam, cursive"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.12
  lane:
    fontFamily: "Kalam, cursive"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.1
  title:
    fontFamily: "Atkinson Hyperlegible, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Atkinson Hyperlegible, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Atkinson Hyperlegible, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  chip: "6px"
  field: "10px"
  wobble-sm: "10px 14px 9px 15px / 14px 9px 15px 10px"
  wobble-card: "12px 16px 10px 18px / 16px 10px 18px 12px"
  wobble: "14px 20px 12px 22px / 20px 12px 22px 14px"
spacing:
  step-4: "4px"
  step-8: "8px"
  step-12: "12px"
  step-16: "16px"
  step-24: "24px"
  step-32: "32px"
components:
  button-primary:
    backgroundColor: "{colors.clay}"
    textColor: "{colors.surface}"
    rounded: "{rounded.wobble}"
    padding: "0 18px"
  button-primary-hover:
    backgroundColor: "{colors.clay-deep}"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.wobble}"
    padding: "0 18px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "9px 12px"
  sheet:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.wobble}"
    padding: "20px"
  task-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.wobble-card}"
    padding: "12px 14px"
  tag:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "1px 9px"
  report-label:
    backgroundColor: "{colors.backlog}"
    textColor: "{colors.backlog-ink}"
    rounded: "{rounded.chip}"
    padding: "2px 8px"
  report-label-stale:
    backgroundColor: "{colors.stale}"
    textColor: "{colors.stale-ink}"
  accepted-stamp:
    backgroundColor: "{colors.completed}"
    textColor: "{colors.completed-ink}"
    rounded: "{rounded.chip}"
    padding: "3px 10px"
---
# Design System: AgentFlow

## Overview

**Creative North Star: "The workshop sketchbook"**

AgentFlow is a single dashboard per project, drawn like a workshop notebook in
graphite and clay. Wobbly pencil outlines, hand-lettered headings, hatching for
blocked work and inked acceptance stamps carry the character. Every fact stays in
a clean, highly legible sans: task titles, numbers, run evidence, fields and
graph labels.

The user chose direction A, "Sketchbook", from the AgentFlow redesign canvas on
2026-10-13. Tokens live as CSS custom properties on `:root` in
`src/app/globals.css`; this file mirrors them.

**Key characteristics:**
- Dotted cream notebook paper behind wobble-cornered sheets.
- One clay action accent. Lane tints always sit beside a written lane name.
- Hand lettering (Kalam) only for headings, lane tabs, agent names and stamps.
- Atkinson Hyperlegible for everything a person reads to make a decision.
- Fonts are bundled under `src/app/fonts/` (SIL OFL 1.1). No remote assets.

## Structure

The project dashboard (`/projects/[projectId]`) is the home of the product. `/`
redirects to the first active project, or shows Projects when none exist.

1. **Top bar.** Brand, project switcher (projects, New project, and the
   workspace pages: All projects, Agents, Activity, Usage, Codex chats),
   connection status in words, Settings and Disconnect browser.
2. **Needs attention.** Blocked tasks, failed runs and stale reports in this
   project as chips, with workspace-wide counts beside them.
3. **Work board.** The hero sheet with all four lanes.
4. **Card grid.** Workflow graph (8 of 12 columns) and Agents (4), then Recent
   runs (5), Activity (4) and Usage (3). Long lists scroll inside their sheet.

Task detail opens as a slide-over from the right with the board behind it.
Agent and run details open the same slide-over from the dashboard. Their URLs
(`/agents/[id]`, `/runs/[id]`, `/projects/[id]/tasks/[id]`) remain full pages
for new tabs and deep links. Settings and pairing stay separate pages.

## Colors

- **Paper / paper-dot:** the canvas and its 22px dot grid.
- **Card / surface:** sheets sit on card cream; task cards and fields are white.
- **Ink / graphite / placeholder:** text at 13.9:1, 6.4:1 and 5.3:1 on paper.
- **Clay family:** primary buttons (white text 5.4:1), links (`clay-deep`),
  scribbled heading underlines, selected graph node ring, usage bars.
- **Lane pairs:** each tint has an ink of the same hue for its label, all at or
  above 6:1. Backlog blue-grey, In progress amber, Review violet, Completed green.
- **Attention / stale:** blocked and failed in red with hatching; stale reports
  in amber with a dashed border.

**The Written Status Rule.** Colour never carries a state alone. Every run label
has an icon and words (`failed · Terminal record`), every lane tab its name, and
every stamp its text.

## Typography

- **Display:** Kalam 700. Sheet headings 30px, small sheet headings 24px, lane
  tabs 21px, dialog titles 28px, page titles 36px.
- **Body and data:** Atkinson Hyperlegible 400/700 (with italics) at 15px/1.5.
  Metadata 13px. Numbers use tabular figures.

**The Clean Facts Rule.** Never set titles, evidence, numbers, field values or
graph labels in the hand face.

## Shapes and pencil recipes

- **Wobble corners.** Asymmetric elliptical radii (`--wobble`, `--wobble-card`,
  `--wobble-sm`) make outlines look hand-drawn without images.
- **Pencil outline.** Sheets and the pair card draw their 2px ink border on a
  `::before` layer filtered by the `#pencil` SVG filter (fractal-noise
  displacement, scale 3) defined once in the root layout.
- **Scribbled underline.** `Scribble` in `src/components/ui/sketch.tsx` draws a
  clay stroke under each sheet heading; five variants avoid repetition.
- **Hatching.** Blocked notes use a 45° red hatch over the attention tint.
- **Inked stamp.** "Human accepted" uses a double green border, rotated −3°.

## Elevation

- **Lift:** buttons sit on `0 2px 0 ink`, pressing down 1px when active.
- **Paper shadow:** task cards and graph nodes use `2px 3px 0` at 12% ink.
- **Overlay:** dialogs, menus and the slide-over use a soft, offset blur.

## Components

- **Buttons.** 44px tall, 2px ink border, wobble corners. Primary is a clay
  gradient with an inner highlight. Disabled buttons turn dashed and flat.
  `secondary` (Move task) is 36px.
- **Fields.** White, 2px ink border, 10px radius, 44px tall, clay caret.
- **Sheet.** Card cream, pencil outline, heading with scribble, optional end
  actions (`View all`, `Create task`).
- **Task card.** Title button and drag handle on top, then priority, role and
  acceptance label; latest run label; blocker; tags; stamp and Move task.
- **Lane tab.** Tinted, 2px border in the lane ink, count pill.
- **Report label.** Tone from state and freshness: ok, fail, live, stale,
  pending, neutral. Icon plus the original words.
- **Slide-over.** 520px, right anchored, sticky title row with Close.
- **Menu.** Card cream with a 2px ink border; clay-tint highlight.
- **Graph node.** White with a state-tinted foot; pending nodes are dashed;
  selected nodes get a clay ring. Zoom controls are 44px sketch buttons.

## Responsive behaviour

- Above 1280px the grid is 8/4 then 5/4/3. Up to 1280px wide sheets span the
  full width and small sheets pair up. At 760px and below everything stacks.
- The board shows four lanes, two lanes below 1100px, and one selected lane with
  the "Show status" selector at 760px and below.
- The slide-over becomes full screen at 760px and below.

## Motion

Small and physical only: buttons press down, cards lift and tilt 0.3° on hover,
the slide-over slides 24px in, menus drop 4px. `prefers-reduced-motion: reduce`
removes all animation and transition.
