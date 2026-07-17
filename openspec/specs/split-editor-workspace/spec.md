# split-editor-workspace Specification

## Purpose
TBD - created by archiving change split-editor-workspace. Update Purpose after archive.
## Requirements
### Requirement: Content area SHALL host a chat + editor split

The session content area SHALL support three layout **modes** —
`closed`, `split`, `full`. In `closed` the content area SHALL render `ChatView`
alone (default). In `split` it SHALL render `ChatView`, a draggable divider, and the
editor pane together. In `full` it SHALL render the editor pane alone with `ChatView`
collapsed to an edge **peek handle**.

On desktop the split SHALL be horizontal (chat left, editor right; chat peek on the
left edge in `full`, editor peek on the right edge in `closed`). At or below the
mobile breakpoint (`useMobile()` true) the split SHALL stack vertically (chat top,
editor bottom) and the peek handle SHALL be an edge grabber on the corresponding
stacked edge.

#### Scenario: Split mode shows both panes
- **GIVEN** a session in `closed` mode showing `ChatView`
- **WHEN** the user selects `split` from the header layout switch
- **THEN** the content area renders `ChatView`, a divider, and the editor pane
- **AND** the conversation remains visible and interactive

#### Scenario: Full mode via the header switch shows the editor alone
- **GIVEN** a session in `split` mode
- **WHEN** the user selects the `Editor` segment of the header switch
- **THEN** the content area renders the editor pane across the full width
- **AND** `ChatView` is collapsed to a peek handle on the leading edge

#### Scenario: Full mode preserves chat draft and scroll
- **GIVEN** `split` mode with unsent text in the composer and the chat scrolled up
- **WHEN** the mode becomes `full` and then `split` again
- **THEN** `ChatView` remains mounted while hidden (not remounted)
- **AND** the composer draft text and scroll position are unchanged on return

#### Scenario: Closed mode shows chat alone
- **GIVEN** a session in `split` or `full` mode
- **WHEN** the user selects `Chat`/`closed`
- **THEN** the content area renders `ChatView` alone
- **AND** the editor pane's persisted state (tabs, tree) is preserved

#### Scenario: Mobile stacks the split vertically
- **GIVEN** the viewport is below the mobile breakpoint
- **WHEN** the mode is `split`
- **THEN** `ChatView` renders above the editor pane with a row-resize divider

#### Scenario: Mobile supports full mode
- **GIVEN** the viewport is below the mobile breakpoint
- **WHEN** the user selects `Editor` (`full`) from the mobile layout switch
- **THEN** the editor pane fills the stacked content area
- **AND** `ChatView` collapses to an edge grabber on the stacked edge that restores `split` when activated

### Requirement: Split SHALL be unsplittable and re-splittable

The session header SHALL expose a **segmented layout switch** (`Chat | Split |
Editor`) that owns the layout axis. The switch SHALL be present in every mode
(including `closed`, where no pane header exists), SHALL indicate the current mode as
the active segment, and SHALL move the content area to any of the three modes in one
click. The legacy single "Split / Unsplit" toggle and the word "Unsplit" SHALL be
retired. Switching modes SHALL NOT destroy the editor pane's persisted state (open
tabs, tree expansion) or the chat conversation.

#### Scenario: Switch reaches any mode in one click
- **GIVEN** the layout switch shows `Split` active
- **WHEN** the user clicks the `Editor` segment
- **THEN** the content area enters `full` mode in a single transition

#### Scenario: Closed reachable directly from full
- **GIVEN** a session in `full` mode
- **WHEN** the user clicks the `Chat` segment
- **THEN** the content area enters `closed` mode
- **AND** the mode value never held `split` between the two states

#### Scenario: Layout switch is keyboard operable and announces the active mode
- **GIVEN** the header layout switch rendered as an exclusive control
- **WHEN** a keyboard user focuses it and presses Arrow keys
- **THEN** focus moves between the `Chat`/`Split`/`Editor` options and Enter/Space selects one
- **AND** the control exposes the current mode as the checked option to assistive tech (`role="radiogroup"`/`radio`, `aria-checked`)

#### Scenario: Mode change preserves pane state
- **GIVEN** `split` mode with three tabs in the editor pane
- **WHEN** the user switches to `closed` and back to `split`
- **THEN** the editor pane renders with the three tabs and the previously active one

#### Scenario: Switch is present when closed
- **GIVEN** a session in `closed` mode (chat only)
- **WHEN** the header renders
- **THEN** the `Chat | Split | Editor` switch is visible with `Chat` active

#### Scenario: Switch is present on mobile
- **GIVEN** the viewport is below the mobile breakpoint
- **WHEN** the mobile session header renders in any mode
- **THEN** the layout switch is present in the mobile header and reflects the current mode

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

### Requirement: Split state SHALL persist per session in localStorage

Layout mode, ratio, and orientation SHALL persist under
`pi-dashboard:split:<sessionId>`, scoped per session id. Persistence SHALL be
best-effort: quota errors and corrupt JSON SHALL NOT crash the workspace. Legacy
persisted state that used the boolean `open` field SHALL migrate on read:
`open:true → mode:"split"`, `open:false → mode:"closed"`. Unrecognised or partial
blobs SHALL fall back to the default (`mode:"closed"`).

#### Scenario: Per-session mode
- **GIVEN** session A in `split` at 50/50 and session B in `closed`
- **WHEN** the user switches from A to B
- **THEN** session B renders in `closed`
- **AND** switching back to A restores `split` at 50/50

#### Scenario: Full mode persists across reload
- **GIVEN** a session left in `full` mode
- **WHEN** the page reloads and the session reopens
- **THEN** the content area renders in `full` (editor-only, chat behind its peek handle)
- **AND** the editor pane's persisted tabs are restored

#### Scenario: Legacy boolean state migrates
- **GIVEN** `localStorage` holds `{ "open": true, "ratio": 0.6, "orientation": "h" }`
- **WHEN** the session opens
- **THEN** the workspace renders in `split` mode at the 60/40 ratio
- **AND** subsequent writes persist the new `mode` shape

#### Scenario: Both-fields blob resolves by precedence and self-heals
- **GIVEN** `localStorage` holds `{ "open": false, "mode": "split", "ratio": 0.5, "orientation": "h" }`
- **WHEN** the session opens
- **THEN** `mode` wins and the workspace renders in `split` (the stale `open:false` is ignored)
- **AND** the next persisted write contains `mode` and NO `open` key

#### Scenario: Corrupt state does not crash
- **GIVEN** `localStorage` holds malformed JSON for `pi-dashboard:split:<id>`
- **WHEN** the session opens
- **THEN** the workspace renders in `closed` mode (default)
- **AND** an error is logged and subsequent mode changes function normally

### Requirement: Opening a file auto-opens the split

The pane SHALL route every file-open entry point (chat file-link, tool-result file
path, file-tree click, search-result selection) through a single `openInSplit` helper.
When the split is closed, the helper SHALL open the split first, then open the file in
the editor pane, focus its tab, and scroll to the requested line when provided. The
`/session/:id/editor` route SHALL be retained as a deep-link that opens the split via
the same helper.

#### Scenario: Clicking a file-link in chat auto-splits
- **GIVEN** the split is closed
- **WHEN** the user clicks a file path rendered in a chat message or tool result
- **THEN** the split opens
- **AND** the clicked file opens in the editor pane as the active tab

#### Scenario: Deep-link route opens the split
- **GIVEN** the split is closed
- **WHEN** the user navigates to `/session/:id/editor?file=src/foo.ts&line=42`
- **THEN** the split opens with `src/foo.ts` active, scrolled to line 42
- **AND** `ChatView` remains rendered alongside the pane

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

### Requirement: Editor pane SHALL host terminal tabs alongside file tabs

The editor pane (in both the session split and the folder-scoped pane) SHALL host terminal tabs (`term:<id>`, viewer kind `terminal`) in the same tab strip as file, diff, and live-server tabs. Terminal tabs SHALL participate in the same activation, reorder, and close behaviors as other tabs. See `terminal-viewer-tab` for terminal lifecycle.

#### Scenario: Terminal tab coexists with file tabs

- **GIVEN** an editor pane with `src/foo.ts` open
- **WHEN** a terminal tab `term:t1` is opened
- **THEN** both tabs SHALL appear in the tab strip and be independently selectable

### Requirement: Pane SHALL expose a new-terminal affordance

The editor pane SHALL provide a control to create a new terminal at the pane's cwd and open it as an active tab. Activating the control SHALL call the terminal-create flow and add the resulting `term:<id>` tab.

#### Scenario: Create a terminal from the pane

- **WHEN** the user activates the pane's new-terminal control in a pane rooted at `/home/u/proj`
- **THEN** a terminal SHALL be created with cwd `/home/u/proj`
- **AND** its `term:<id>` tab SHALL open active in the pane

