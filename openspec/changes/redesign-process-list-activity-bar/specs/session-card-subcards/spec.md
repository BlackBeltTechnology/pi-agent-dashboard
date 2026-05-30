## MODIFIED Requirements

### Requirement: PROCESS subcard composition
The PROCESS subcard SHALL render two stacked surfaces in order: `<SessionActivityBar />` above `<BackgroundProcessesDrawer />`. The subcard SHALL be hidden when both surfaces have nothing to render.

#### Scenario: Both surfaces empty hides subcard
- **GIVEN** the activity bar has zero in-flight bash tools AND the drawer receives zero processes
- **WHEN** the session card renders
- **THEN** the PROCESS subcard SHALL NOT render (zero DOM nodes for that section)

#### Scenario: Only activity bar non-empty
- **GIVEN** the activity bar has 1 in-flight bash tool AND the drawer receives zero processes
- **WHEN** the session card renders
- **THEN** the PROCESS subcard SHALL render with the activity bar visible and the drawer absent

#### Scenario: Only drawer non-empty (pure-orphan)
- **GIVEN** the activity bar has zero in-flight bash tools AND the drawer receives 2 processes
- **WHEN** the session card renders
- **THEN** the PROCESS subcard SHALL render with the activity bar absent and the drawer visible and expanded by default

#### Scenario: Both surfaces non-empty
- **GIVEN** the activity bar has 1 in-flight bash tool AND the drawer receives 2 processes
- **WHEN** the session card renders
- **THEN** the PROCESS subcard SHALL render with the activity bar above and the drawer below
- **AND** the drawer SHALL be collapsed by default

### Requirement: Per-session drawer toggle state
The session card SHALL own per-session client state for the drawer's user-overridden expansion. The override SHALL persist for the lifetime of the client session and SHALL take precedence over the contextual default.

#### Scenario: Toggle persists across content changes
- **GIVEN** the user has collapsed the drawer in a pure-orphan state (default was expanded)
- **WHEN** the activity bar gains and loses an in-flight tool, then becomes empty again
- **THEN** the drawer SHALL render collapsed (user override wins)

#### Scenario: Toggle is per-session
- **GIVEN** session A has its drawer collapsed via user toggle
- **WHEN** session B renders for the first time
- **THEN** session B's drawer SHALL use the contextual default (no inherited state from session A)
