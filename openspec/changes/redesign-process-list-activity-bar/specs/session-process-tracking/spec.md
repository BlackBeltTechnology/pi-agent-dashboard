## MODIFIED Requirements

### Requirement: Client renders the PGID scan as a collapsible drawer
The client-side `ProcessList` (renamed semantically to "BackgroundProcessesDrawer," filename unchanged) SHALL render the bridge's PGID scan as a collapsible drawer beneath the activity bar, replacing today's always-expanded list with skeleton padding.

#### Scenario: Drawer collapsed shows only summary row
- **GIVEN** the drawer receives 3 processes and `expanded === false`
- **WHEN** it renders
- **THEN** it SHALL render a single summary row with text `"⚠ 3 background processes"` and a chevron indicator
- **AND** it SHALL NOT render any individual process rows
- **AND** clicking the summary row SHALL invoke `onToggle`

#### Scenario: Drawer expanded shows rows
- **GIVEN** the drawer receives 3 processes and `expanded === true`
- **WHEN** it renders
- **THEN** it SHALL render the summary row plus 3 process rows
- **AND** each process row SHALL retain today's truncated command, elapsed time, and ✕ kill button

### Requirement: Drawer per-row ✕ continues to invoke PGID kill
The per-row ✕ button in the drawer SHALL continue to call `onKill(pgid)` (SIGTERM→SIGKILL via the existing `force_kill` path). It SHALL NOT be confused with the activity bar's stop verb.

#### Scenario: Drawer kill click hits the PGID path
- **GIVEN** an expanded drawer with a process row for `pgid=48213`
- **WHEN** the user clicks the ✕ on that row
- **THEN** the component SHALL invoke `onKill(48213)`

#### Scenario: Drawer kill tooltip
- **GIVEN** an expanded drawer row
- **WHEN** the user hovers the ✕ button
- **THEN** the tooltip SHALL indicate force-kill of the process tree (literal copy: `"Force-kill process tree"`)

### Requirement: Skeleton row padding removed
The drawer SHALL NOT pad its rendered output with invisible skeleton rows. Previous `MIN_SLOTS=5` padding is removed; the activity bar above provides the card's stable visual surface.

#### Scenario: One process renders one row
- **GIVEN** the drawer receives 1 process and `expanded === true`
- **WHEN** it renders
- **THEN** it SHALL render the summary row plus exactly 1 process row
- **AND** it SHALL NOT render any aria-hidden skeleton rows

### Requirement: Overflow tail preserved
Excess processes beyond `MAX_VISIBLE=5` SHALL continue to collapse into a single `+N more processes` row with a tooltip listing the hidden command lines. This behaviour is preserved from today.

#### Scenario: Seven processes render with overflow
- **GIVEN** the drawer receives 7 processes and `expanded === true`
- **WHEN** it renders
- **THEN** it SHALL render the summary row plus 5 process rows plus 1 `+2 more processes` overflow row
- **AND** the overflow row SHALL expose the hidden commands via its `title` attribute

### Requirement: Drawer default state is contextual
The drawer's initial expansion state SHALL be `true` when the activity bar above is empty AND the drawer's process list is non-empty; otherwise `false`. User toggles SHALL override and persist per session.

#### Scenario: Pure-orphan state opens drawer
- **GIVEN** the activity bar has zero in-flight bash tools AND the drawer has 2 processes AND no user toggle has been applied
- **WHEN** the PROCESS subcard renders
- **THEN** the drawer SHALL render with `expanded === true`

#### Scenario: Activity present collapses drawer
- **GIVEN** the activity bar has 1 in-flight bash tool AND the drawer has 2 processes AND no user toggle has been applied
- **WHEN** the PROCESS subcard renders
- **THEN** the drawer SHALL render with `expanded === false`

#### Scenario: User toggle is remembered for the session
- **GIVEN** the drawer's contextual default is `expanded === true`
- **WHEN** the user clicks the summary row to collapse it
- **AND** the activity bar later becomes non-empty and back to empty
- **THEN** the drawer SHALL remain collapsed until the user explicitly re-opens it
