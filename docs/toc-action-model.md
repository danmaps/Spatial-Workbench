# TOC layer action model

This document defines the intended interaction model for the Table of Contents (TOC) layer list in Spatial Workbench.

It is deliberately aligned to the current implementation in `js/app.js` rather than proposing a heavier GIS-style control surface.

## Goals

The TOC should:

- keep the default layer row visually quiet
- make multi-selection obvious and fast
- keep secondary actions discoverable without cluttering every row
- work on desktop and touch devices without needing separate UI concepts
- leave room for future layer actions without expanding the row into a toolbar

## Canonical row model

Each layer row has two levels of interaction:

1. **Primary row interaction** — selection
2. **Secondary menu interaction** — per-layer actions and details

This keeps the row itself simple while still supporting richer actions.

## What is visible by default in a layer row

By default, every TOC layer row shows only:

- a **selection checkbox**
- the **layer display name**
- an **ellipsis action trigger**

Not shown inline by default:

- source badges
- geometry metadata
- tool history
- destructive actions
- rename controls
- properties/details panels

Those are intentionally deferred to the menu or modal.

## Meaning of each visible control

### Checkbox

The checkbox is the most explicit selection control.

- checked = layer is part of the current selection set
- unchecked = layer is not selected

Changing the checkbox updates the selection summary and enables selection-level actions such as **Zoom to selection**.

### Layer name

The layer name is the primary label for identification.

- it uses the canonical display name from `state.getLayerInfo()` / naming helpers
- double-clicking the name enters rename mode
- rename is considered a secondary edit action, not a primary row action

### Ellipsis trigger

The ellipsis is the single entry point for per-layer actions.

It is always present structurally, but its visibility differs by input mode:

- desktop pointer devices: hidden until hover/focus/open
- touch/coarse pointer devices: visible by default

## What clicking the row itself means

Clicking the row itself means:

- **toggle selection for that layer**

That is the core row behavior.

Specifically:

- clicking empty space in the row toggles selection
- clicking the checkbox also toggles selection, via the checkbox control itself
- clicking the ellipsis trigger does **not** toggle selection
- clicking an action inside the menu does **not** toggle selection
- double-clicking the label starts rename instead of performing a separate row action

This model intentionally avoids overloading single-click row interaction with zoom, open-details, or visibility toggling.

## What goes behind the ellipsis menu

The ellipsis menu is the home for actions that are useful but not needed on every scan of the TOC.

Current menu contents:

- **Zoom to layer**
- **Rename layer**
- **Layer properties**
- **Remove layer**

The menu also includes compact layer context above the actions:

- geometry label
- source label
- tool-history summary or geometry type fallback
- stable layer id

This makes the menu both an action surface and a lightweight context panel.

## Desktop hover and focus behavior

On desktop-class pointer devices (`hover: hover` and `pointer: fine`):

- the ellipsis trigger stays visually hidden by default
- it becomes visible when the row is:
  - hovered
  - keyboard-focused / focus-within
  - already menu-open

Expected result:

- the TOC stays visually clean during scanning
- keyboard users can still discover the action affordance
- opening a menu keeps the trigger visible so the control does not visually disappear mid-task

Keyboard expectation:

- the row itself can receive focus
- `Enter` or `Space` on the row toggles selection
- `Escape` closes any open layer menu

## Touch / mobile fallback behavior

On touch or coarse-pointer devices:

- the ellipsis trigger is visible by default
- there is no dependency on hover for action discovery
- row tap still means selection toggle
- explicit action taps happen through the ellipsis menu

This avoids hidden affordances on mobile.

The model prefers explicit taps over gesture-only behavior. Long-press or swipe actions are not part of the current contract.

## Why selection is the primary row action

The TOC already supports selection-aware behavior such as:

- selection count summary
- zooming to the current selection

Making row click mean selection keeps the mental model consistent:

- row = part of working set
- menu = things you do to one layer

That is simpler than making row click open properties, zoom, or toggle visibility.

## How future actions should be added

To avoid row clutter, future per-layer actions should follow this rule:

- **default row stays minimal**
- **new per-layer actions go into the ellipsis menu first**

Only promote an action out of the menu if it is:

1. used constantly,
2. semantically primary, and
3. worth the permanent visual cost across every row.

### Good candidates to keep in the menu

- duplicate layer
- export layer
- derive new analysis output
- style options
- opacity
- re-run source tool
- visibility toggles, if/when hidden layer state becomes persistent
- z-order actions

### Good candidates for modal/details surfaces instead of inline row UI

- provenance/history inspection
- import warnings
- raw properties
- geometry stats
- advanced styling/config

## Non-goals of the current TOC row

The current TOC row is **not** trying to be:

- a full layer styling panel
- a desktop GIS legend tree
- a persistent inspector
- a dense action toolbar

That complexity belongs in menus, modals, or future dedicated panels.

## Relationship to the canonical layer model

This interaction model depends on the canonical layer model documented in `docs/layer-model.md`:

- `displayName` drives the visible label
- `geometry` and `source` feed menu context
- `provenance.history` feeds lightweight action context
- `ui.visible` is available for future visibility controls, but is not yet exposed as a primary row toggle

## Implementation note

As of this document, the intended behavior is implemented in `js/app.js` and styled in `public/css/main.css`.

If future changes add more row content, they should preserve the core contract:

- **row = selection**
- **ellipsis = layer actions/details**
- **touch never depends on hover**
