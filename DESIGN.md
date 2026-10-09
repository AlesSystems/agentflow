---
name: AgentFlow
description: A classic engineering issue ledger with visible execution evidence.
---

<!-- SEED: established with the user before implementation; re-run $impeccable document once there's code to capture the actual tokens and components. -->

# Design System: AgentFlow

## Overview

**Creative North Star: "The Engineering Issue Ledger"**

The user selected a classic Kanban direction on 2026-10-09. Familiar navigation,
readable task titles, and restrained metadata make frequent engineering work
easy to scan. The character is direct, orderly, and practical.

Use light, opaque work surfaces. Information establishes hierarchy through
alignment, spacing, and weight. Images are unnecessary for the working interface;
icons support text labels. The reusable signature is a task record with a clearly
attributed evidence trail: what happened, when it was reported, and who accepted
the result remain easy to distinguish.

Motion communicates a navigation or state change. Keep it brief, preserve focus,
and honor reduced motion. Avoid continuous ambient animation in a working view.

**Key Characteristics:**

- Familiar controls and clear task hierarchy.
- Quiet surfaces with one action accent.
- Explicit labels for outcomes, uncertainty, and human acceptance.
- Evidence available beside the work without crowding its summary.

## Colors

Use a light neutral canvas, opaque white or near-white records, dark readable
text, thin neutral boundaries, and one blue action accent. The selection-page
swatches illustrate this direction; they are not implementation tokens.
Exact palette, semantic status colors, and contrast pairs are
[to be resolved during implementation].

**The Status Label Rule.** Every status and freshness signal has a text label;
color supplements it. Action color identifies an available action or selection,
not proof that a task has been accepted.

## Typography

Use an offline system sans stack for navigation, task titles, forms, and prose.
Titles lead; metadata stays subordinate but readable. Use tabular numerals where
alignment helps compare counts or timestamps. A separate display face is
unnecessary for the working application.

Exact font stack, sizes, weights, line heights, and text-width limits are
[to be resolved during implementation]. Establish the hierarchy at normal size
and verify it at 200% zoom.

## Layout

Organize work with aligned headers, a compact navigation layer, and clearly
grouped content. Keep primary actions close to the content they change. The
board's composition belongs in its [surface brief](.impeccable/surfaces/src-app-projects-projectid-page-tsx.md);
other routes inherit this system without inheriting four columns.

Narrow layouts preserve reading order and reachable actions. Use a full-page
detail view when a side panel no longer fits comfortably. Spacing scale,
container dimensions, column widths, and breakpoints are
[to be resolved during implementation].

## Elevation & Depth

Surfaces are flat at rest. Thin borders and tonal separation organize records.
Reserve elevation for menus, dialogs, and panels that actually overlay content.
Avoid stacked shadows on ordinary task records. Exact overlay shadows and
layering values are [to be resolved during implementation].

## Shapes

Use rectangular records and gently rounded interactive controls. Keep corners
consistent across equivalent controls; use pills only where the compact shape
helps identify a tag. Thin borders define boundaries without becoming decoration.
Exact radii, border values, and icon sizing are
[to be resolved during implementation].

## Do's and Don'ts

- **Do** make task titles the first readable element in a work record.
- **Do** keep outcomes, report freshness, and human acceptance visually distinct.
- **Do** use the same control vocabulary across board, details, agents, and activity.
- **Do** preserve explicit focus, error, pending, and disabled states.
- **Don't** turn the board into an analytics wall or an agent command console.
- **Don't** encode status in color alone or present stale reports as live facts.
- **Don't** import Fizzy assets or fetch fonts and decorative assets remotely.

This file establishes direction only. No components or tokens have been
implemented or visually verified. After implementation, run `$impeccable document`
to capture real tokens and generate `.impeccable/design.json`.
