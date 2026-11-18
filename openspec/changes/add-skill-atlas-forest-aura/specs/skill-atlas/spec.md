# Spec Delta

## MODIFIED Requirements

### Requirement: Atlas views

The atlas SHALL offer Cards, Graph and Links views (keyboard-operable tabs). Search, relation-type toggles and origin toggles (Project, Global, Package) SHALL apply to all three. Relation type SHALL be conveyed by colour, line style and name together, and origin by a non-colour cue in every view. In the graph every skill SHALL be drawn with the same circular outline, and its origin by the mark inside it: Global empty, Package a filled centre dot, Project an inner ring. Colour SHALL never be the only cue.

- **Selection.** Selecting a skill in any view SHALL open a detail panel showing:
  - its description, path, origin and package (if its SKILL.md cannot be opened, an inline error SHALL be shown);
  - its neighbours grouped by relation, each with the reason;
  - a focus control (All, 1 hop, 2 hops);
  - an action to open its SKILL.md.

  A mutual reference SHALL appear as one neighbour entry marked as bidirectional.
- **Search and focus behaviour.**
  - In the graph, focus SHALL re-fit the view to the focused neighbourhood, and non-matching nodes SHALL be dimmed.
  - In Cards and Links, non-matching items SHALL be hidden, and a status line "Showing N of M" with a Clear action SHALL be shown.
- **Scale limit.** Above 300 skills the Graph view SHALL be disabled with a stated reason, while Cards and Links keep working.
- **Determinism.** When the atlas is opened, the graph layout SHALL be identical for an identical graph, the same visible relation types and the same viewport size. After the user drags a node or toggles a relation type, or after a live update changes the graph, positions MAY differ from a fresh open.

#### Scenario: Links table is the graph's text equivalent
- **WHEN** the user switches to Links with the same filters as the graph
- **THEN** the table SHALL list exactly the links the graph draws, with source, relation, target and reason

#### Scenario: Graph keyboard access
- **WHEN** the graph has focus and the user presses Right Arrow then Enter
- **THEN** the most-connected skill SHALL be selected and its details shown

#### Scenario: Mutual reference shown once
- **WHEN** `plan-proposal` and `ship-it` reference each other and `plan-proposal` is selected
- **THEN** the detail panel SHALL list `ship-it` once, marked bidirectional

#### Scenario: Focus filters cards by hiding
- **WHEN** 1-hop focus is active on a skill with 5 neighbours and the Cards view is shown
- **THEN** exactly 6 cards SHALL be visible and the status line SHALL read "Showing 6 of <total>"

#### Scenario: Large set disables graph
- **WHEN** the scope resolves 312 skills
- **THEN** the Graph tab SHALL be disabled and an explanation SHALL be shown, and Cards SHALL list all 312

#### Scenario: Same graph, same picture
- **WHEN** the atlas is opened twice for an unchanged graph at the same viewport size, with no node dragged
- **THEN** every node SHALL be drawn at the same position

#### Scenario: Origin readable without colour
- **WHEN** the graph shows one Global, one Package and one Project skill, each at the smallest node size, and is viewed in greyscale
- **THEN** the three nodes SHALL share one outline and be told apart by their inner mark alone: none, a filled dot, a hollow ring

## ADDED Requirements

### Requirement: Forest outlines in the graph

The graph SHALL group skills into forests: sets connected through the currently visible links. Each forest of two or more skills SHALL be enclosed by one rounded outline that follows its nodes, including while they move. A single unlinked skill SHALL get no outline. When the graph is opened, outlines of different forests SHALL NOT overlap.

#### Scenario: Outline per connected group
- **WHEN** the visible links form three groups of 5, 3 and 2 skills plus 2 unlinked skills
- **THEN** the graph SHALL draw exactly three outlines, each enclosing exactly one group's nodes, and no outline around the unlinked skills

#### Scenario: Outlines do not overlap on open
- **WHEN** the atlas graph is opened for the bundled 49-skill fixture and for 150 two-skill forests
- **THEN** no two forest outlines SHALL intersect

#### Scenario: Relation filter re-forms forests
- **WHEN** the "same package" relation is turned off and two skills were joined only by a same-package link
- **THEN** the graph SHALL draw them in separate forests (or without an outline when alone) and SHALL re-settle into the new grouping without a page reload

### Requirement: Zoom to a forest

Clicking a forest outline SHALL fit the view to that forest, dim everything outside it, and show a control naming the forest's size with a keyboard-focusable "Show all" button; clicking another forest's outline SHALL switch to it. Escape, "Show all", or a click on empty graph space SHALL return to the whole graph. Escape SHALL leave forest zoom before it clears a selection. A press that moves 4 px or more SHALL pan instead. Forest zoom is pointer-only.

#### Scenario: Click outline zooms in
- **WHEN** the user clicks the outline of a 5-skill forest
- **THEN** the view SHALL fit that forest, other forests SHALL be dimmed, and a control reading "Group: 5 skills" with "Show all" SHALL be shown

#### Scenario: Escape leaves zoom before clearing selection
- **WHEN** a skill is selected, its forest is zoomed, and the user presses Escape with the graph focused
- **THEN** the whole graph SHALL be shown with no forest dimming and the skill SHALL stay selected; a second Escape SHALL clear the selection

#### Scenario: Click outside returns
- **WHEN** a forest is zoomed and the user clicks empty graph space
- **THEN** the whole graph SHALL be shown again

#### Scenario: Escape after a pointer zoom
- **WHEN** the user zooms a forest by clicking its outline and then presses Escape without clicking anything else
- **THEN** the whole graph SHALL be shown again

#### Scenario: Drag on an outline pans
- **WHEN** the user presses on a forest outline and moves 30 px before releasing
- **THEN** the view SHALL pan by 30 px and SHALL NOT zoom to the forest

### Requirement: Draggable graph nodes

The user SHALL be able to drag a graph node with a pointer. While dragged the node SHALL follow the pointer and its linked nodes SHALL be pulled along. On release, or when the pointer is cancelled or capture is lost, the node SHALL be released and settle back into the layout gradually, without a jump. A press that moves less than 4 px SHALL count as a click (selection), not a drag.

#### Scenario: Neighbours follow a drag
- **WHEN** the user drags a node that has two linked neighbours 60 px to the right
- **THEN** the node SHALL be under the pointer and both neighbours SHALL have moved toward it

#### Scenario: Release settles gradually
- **WHEN** the user releases a dragged node
- **THEN** the node SHALL be free of the pointer and drift into place over several frames rather than jumping there in one

#### Scenario: Cancelled pointer releases the node
- **WHEN** a drag is in progress and the browser cancels the pointer
- **THEN** the node SHALL be released and the graph SHALL come to rest as after a normal release

#### Scenario: Small press selects
- **WHEN** the user presses a node and releases it after moving 2 px
- **THEN** the node SHALL be selected and its details shown

### Requirement: Graph camera moves only on explicit actions

The view SHALL fit the whole graph once when it first comes to rest. After that it SHALL move only on the user's own pan or zoom (wheel, drag or zoom buttons), the Fit control, a focus change, entering or leaving forest zoom, or a viewport resize when the user has not panned or zoomed since the last of these fits. Plain selection, re-settling and dragging SHALL NOT move it.

#### Scenario: Settling does not move the camera
- **WHEN** the user toggles a relation type and the graph re-settles
- **THEN** the view transform SHALL stay unchanged throughout

#### Scenario: Resize refits until the user pans
- **WHEN** the viewport is resized before any pan or zoom, and resized again after a pan
- **THEN** the first resize SHALL re-fit the graph and the second SHALL NOT

#### Scenario: Selection keeps the camera
- **WHEN** focus is All and the user selects a different skill
- **THEN** the view transform SHALL stay unchanged

### Requirement: Graph motion respects reduced motion and idles

With reduced motion requested, re-settles and view changes SHALL apply in one step. Nothing SHALL run per frame while the graph is at rest or the document is hidden.

#### Scenario: Reduced motion
- **WHEN** reduced motion is requested and the user clicks a forest outline or toggles a relation type
- **THEN** the new view and the new layout SHALL each appear in a single step without animation

#### Scenario: Idle when at rest
- **WHEN** the graph has come to rest, or the document is hidden
- **THEN** no animation frame or simulation tick SHALL be scheduled until the next interaction or, for a hidden document that was still settling, until it is visible again

### Requirement: Graph labels never overlap

Graph labels SHALL never overlap one another or cross the edge of the graph area. Labels other than the hovered and selected ones SHALL NOT cover any node, dimmed nodes included: each SHALL take a free side of its node (right, left, below, above) or be hidden. The hovered label, then the selected label, SHALL be placed first; they MAY cover a node when no side is free of nodes. The hovered label SHALL always be shown.

#### Scenario: Dense cluster labels
- **WHEN** a zoomed forest contains 17 labelled skills packed closely
- **THEN** no two drawn label boxes SHALL intersect, and no label other than the hovered or selected one SHALL cover a node

#### Scenario: Hidden label on hover
- **WHEN** a skill's label was hidden for lack of space and the pointer hovers that skill
- **THEN** its label SHALL be shown, and any conflicting label SHALL be hidden instead
