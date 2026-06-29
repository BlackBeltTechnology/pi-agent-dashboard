## ADDED Requirements

### Requirement: Session card action row with divider
Each desktop session card SHALL display a thin horizontal divider (`border-t border-gray-700/30`) below the **subcard stack** (OPENSPEC / WORKSPACE / PROCESS / MEMORY / FLOWS, see `session-card-subcards`). Below the divider, an action row SHALL contain: editor buttons (if available), source badge, and hide/unhide button.

The grouped controls (OpenSpec attach combo, git workspace pills, process list, memory plugin contributions, flow launcher) SHALL NOT appear in this action row — they live inside their respective subcards above the divider. The action row SHALL contain only the per-card chrome: editor buttons, source badge, hide/unhide.

#### Scenario: Card with editor buttons and source badge
- **WHEN** a session card is rendered with detected editors
- **THEN** the card SHALL show the header zone, the populated subcard stack, a thin divider, then an action row with editor buttons on the left, source badge in the middle, and hide button on the right

#### Scenario: Card without editor buttons
- **WHEN** a session card is rendered without detected editors
- **THEN** the action row SHALL show only the source badge and hide/unhide button

#### Scenario: Action row contains no grouped section controls
- **WHEN** a session card is rendered
- **THEN** the action row SHALL NOT contain `SessionOpenSpecActions`, `GitInfo`, `ProcessList`, or `SessionFlowActions` — those SHALL render inside their subcards above the divider

### Requirement: Selected card accent
The currently selected session card SHALL display a subtle left border accent (`border-l-2 border-blue-500/40`) in addition to the existing background highlight. All session cards SHALL have an explicit `bg-[var(--bg-tertiary)]` background to create visual layering within the folder container.

#### Scenario: Card selected
- **WHEN** a session card is the currently selected session
- **THEN** the card SHALL have `bg-[var(--bg-tertiary)]` background AND a `border-l-2 border-blue-500/40` left accent

#### Scenario: Card not selected
- **WHEN** a session card is not selected
- **THEN** the card SHALL have `bg-[var(--bg-tertiary)]` background with no left accent border

#### Scenario: Card layering within folder
- **WHEN** a session card is rendered inside a folder group container
- **THEN** the card background (`--bg-tertiary`) SHALL be visually distinct from the folder container background (`--bg-secondary`)

### Requirement: Source badge in action row
The source badge (tui, tmux, dashboard, zed) SHALL be displayed in the action row below the divider, rather than inline with the session name on the first line.

#### Scenario: Source badge position
- **WHEN** a session card is rendered
- **THEN** the source badge SHALL appear in the action row below the thin divider, not on the first line next to the session name

### Requirement: Full-card background pulse for working sessions
Session cards SHALL display a slow pulsing background tint animation when the session is in `streaming` status or has `resuming` set to true. The animation SHALL cycle the card's background color between transparent and a faint amber tint (`rgba(234, 179, 8, 0.06)`) over a 3-second ease-in-out infinite loop using a `card-working-pulse` CSS keyframe defined in `index.css`.

#### Scenario: Streaming session card pulses
- **WHEN** a session card is rendered with `session.status === "streaming"`
- **THEN** the card `<li>` element SHALL have the `card-working-pulse` animation applied

#### Scenario: Resuming session card pulses
- **WHEN** a session card is rendered with `session.resuming === true`
- **THEN** the card `<li>` element SHALL have the `card-working-pulse` animation applied

#### Scenario: Idle session card does not pulse
- **WHEN** a session card is rendered with `session.status === "idle"` and `session.resuming` is falsy
- **THEN** the card `<li>` element SHALL NOT have the `card-working-pulse` animation

#### Scenario: Ended session card does not pulse
- **WHEN** a session card is rendered with `session.status === "ended"`
- **THEN** the card `<li>` element SHALL NOT have the `card-working-pulse` animation
