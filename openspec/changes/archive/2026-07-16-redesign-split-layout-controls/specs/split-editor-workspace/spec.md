# split-editor-workspace — delta

## MODIFIED Requirements

### Requirement: Divider SHALL resize the split and persist the ratio

In `split` mode a draggable divider SHALL resize the two panes. The divider SHALL
be **resize-only**: it SHALL carry an always-visible dotted grip signifier and SHALL
NOT carry any collapse control. Collapsing a pane SHALL be driven solely by the
header layout-mode switch (`Chat│Split│Editor`). The split ratio SHALL be stored as a
fraction (0..1), clamped to `[0.25, 0.75]` so neither pane collapses below a usable
minimum, and SHALL persist per session. The ratio SHALL apply only in `split` mode.

#### Scenario: Dragging resizes both panes
- **WHEN** the user drags the divider left in `split` mode
- **THEN** the chat pane narrows and the editor pane widens by the same amount
- **AND** the divider stops at the clamp boundary before either pane collapses

#### Scenario: Divider carries no collapse control
- **GIVEN** `split` mode
- **THEN** the divider renders an always-visible dotted grip and no collapse chevrons
- **AND** the header switch is the only control that collapses a pane; the pane
  restore tabs only re-open a collapsed pane (they never collapse one)

#### Scenario: Grip is always visible, not hover-only
- **GIVEN** `split` mode with no pointer over the divider
- **THEN** the dotted grip signifier is visible at rest (not revealed only on hover)

#### Scenario: Ratio persists across reload
- **GIVEN** the user set the split ratio to 60/40
- **WHEN** the page reloads and the mode re-opens to `split`
- **THEN** the panes render at the 60/40 ratio

### Requirement: Peek handles SHALL restore a collapsed pane

Each pane SHALL show an always-visible caption (`CHAT` / `EDITOR`) at its top while
open; the caption SHALL be folded into the pane's existing header row, NOT added as
a second bar. This requirement governs the **desktop horizontal split
(`orientation "h"`)**; the stacked mobile split (`orientation "v"`) is out of scope
here and retains the existing edge-grabber peek behavior defined by the untouched
"Content area SHALL host a chat + editor split" requirement, and the tablet
`replaceChat` tier (editor replaces chat, no side-by-side) renders no caption,
divider, or restore tab. When a pane is collapsed the workspace SHALL render an
**always-visible, in-flow rotated tab** on the collapsed pane's edge so the pane is
re-openable without the header (this tab is the desktop form of the affordance the
parent requirement calls a "peek handle"). The restore tab SHALL be an in-flow
sibling that reduces content width (push), and SHALL NOT overlay or clip the
adjacent pane's content. In `closed` mode a right-edge `EDITOR` tab SHALL re-open to
`split`. In `full` mode a leading-edge `CHAT` tab SHALL restore `split`. Activating a
tab SHALL NOT destroy the other pane's state. The restore tab SHALL be a keyboard-
focusable control with an accessible name (activated by Enter/Space); the pane
caption SHALL be decorative (`aria-hidden`) or carry an accessible label, not a
bare unlabeled element.

#### Scenario: Editor tab reopens the split
- **GIVEN** `closed` mode (chat only)
- **WHEN** the user activates the right-edge `EDITOR` tab
- **THEN** the mode becomes `split` and the editor pane renders with its prior tabs

#### Scenario: Chat tab restores chat
- **GIVEN** `full` mode (editor only)
- **WHEN** the user activates the leading-edge `CHAT` tab
- **THEN** the mode becomes `split` and the conversation is visible again

#### Scenario: Restore tab never overlaps a narrow pane
- **GIVEN** `split` collapsed to a narrow chat pane, then a pane collapsed
- **THEN** the restore tab and pane caption sit at the pane edge as in-flow elements
- **AND** they do NOT overlay or clip the visible pane's content

#### Scenario: Content opener from full returns to split
- **GIVEN** `full` mode (editor only)
- **WHEN** a content-driven opener fires (e.g. the header Changed-Files chip, or a chat file-link)
- **THEN** the mode becomes `split` so chat stays visible alongside the opened content
- **AND** the opener never sets `full`

#### Scenario: Mobile stacked split keeps its existing edge grabber
- **GIVEN** the split renders stacked (`orientation "v"`) on a mobile viewport
- **WHEN** a pane is collapsed
- **THEN** the existing edge-grabber peek restores the pane (unchanged)
- **AND** the desktop rotated-tab form is NOT required in this orientation

#### Scenario: Restore tab is keyboard accessible
- **GIVEN** a collapsed pane showing its restore tab
- **WHEN** the user focuses the tab and presses Enter or Space
- **THEN** the pane re-opens to `split`
- **AND** the tab exposes an accessible name to assistive tech
