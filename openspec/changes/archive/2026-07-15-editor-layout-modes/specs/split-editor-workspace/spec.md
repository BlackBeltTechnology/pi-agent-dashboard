## MODIFIED Requirements

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

In `split` mode a draggable divider SHALL resize the two panes, and the divider
SHALL carry on-border collapse controls: a `‹` chevron that collapses the chat
(→ `full`) and a `›` chevron that collapses the editor (→ `closed`). Each chevron
SHALL point at the pane it folds away. Dragging SHALL NOT trigger a chevron and a
chevron click SHALL NOT start a drag. The split ratio SHALL be stored as a fraction
(0..1), clamped to `[0.25, 0.75]` so neither pane collapses below a usable minimum,
and SHALL persist per session. The ratio SHALL apply only in `split` mode.

#### Scenario: Dragging resizes both panes
- **WHEN** the user drags the divider left in `split` mode
- **THEN** the chat pane narrows and the editor pane widens by the same amount
- **AND** the divider stops at the clamp boundary before either pane collapses

#### Scenario: Left chevron collapses chat to full
- **GIVEN** `split` mode
- **WHEN** the user clicks the `‹` chevron (points at the chat it folds)
- **THEN** the chat collapses and the mode becomes `full`

#### Scenario: Right chevron collapses editor to closed
- **GIVEN** `split` mode
- **WHEN** the user clicks the `›` chevron (points at the editor it folds)
- **THEN** the editor collapses and the mode becomes `closed`

#### Scenario: Chevron click does not start a drag-resize
- **GIVEN** `split` mode at a 50/50 ratio
- **WHEN** the user clicks (press + release without movement) the `›` chevron
- **THEN** the mode becomes `closed`
- **AND** the persisted ratio is unchanged (no resize was recorded)

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

## ADDED Requirements

### Requirement: Peek handles SHALL restore a collapsed pane

When a pane is collapsed the workspace SHALL render a slim, always-visible **peek
handle** on the collapsed pane's edge so the pane is re-openable without the header.
In `closed` mode a right-edge "Editor" peek SHALL re-open to `split`. In `full` mode
a leading-edge "Chat" peek SHALL restore `split`. Activating a peek SHALL NOT destroy
the other pane's state.

#### Scenario: Editor peek reopens the split
- **GIVEN** `closed` mode (chat only)
- **WHEN** the user activates the right-edge "Editor" peek handle
- **THEN** the mode becomes `split` and the editor pane renders with its prior tabs

#### Scenario: Chat peek restores chat
- **GIVEN** `full` mode (editor only)
- **WHEN** the user activates the leading-edge "Chat" peek handle
- **THEN** the mode becomes `split` and the conversation is visible again

#### Scenario: Content opener from full returns to split
- **GIVEN** `full` mode (editor only)
- **WHEN** a content-driven opener fires (e.g. the header Changed-Files chip, or a chat file-link)
- **THEN** the mode becomes `split` so chat stays visible alongside the opened content
- **AND** the opener never sets `full`
