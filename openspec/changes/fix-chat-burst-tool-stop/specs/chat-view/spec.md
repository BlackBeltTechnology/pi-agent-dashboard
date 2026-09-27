## ADDED Requirements

### Requirement: Running burst exposes a shared stop control

While a burst group contains a visible member (a member not hidden by the per-tool-kind display preference) whose `toolStatus` is `running` and the chat view supplies an abort handler, the burst SHALL render a stop control in its header row regardless of whether the burst is expanded or collapsed. The burst SHALL own exactly ONE stop state (`idle` → `aborting` → `killing`) shared by the header control and by the stop control of every running member row in its body. Clicking Stop (in `idle`) SHALL send an `abort` message for the session and - when a force-kill handler is also supplied - move the shared state to `aborting`, where every control SHALL render Force Stop (without a force-kill handler the control SHALL stay Stop, matching the composer). This control escalates immediately (no grace timer). Clicking Force Stop SHALL send a `force_kill` message and move the shared state to `killing`, where every control SHALL render a disabled Killing state. The shared state SHALL survive collapsing and re-expanding the burst body (it is not required to survive the burst row being virtualized off-screen). When no visible member is running, no stop control SHALL render and the shared state SHALL reset to `idle`.

Stop and Force Stop controls SHALL be real focusable buttons with an accessible name; the Killing state SHALL be a disabled button with an accessible name. All stop controls SHALL be placed OUTSIDE the header/row toggle button, so that activating a stop control SHALL NOT toggle the burst's or row's expanded state, and the header toggle button SHALL keep its existing `tool-burst-header` test id. On mobile viewports each stop control's own hit area SHALL be at least 44×44 CSS px. Rows whose `toolStatus` is not `running` SHALL render no stop control. When the abort handler is absent, no stop control SHALL render.

#### Scenario: Collapsed running burst shows Stop in the header

- **GIVEN** a burst whose only member is a `bash` tool with `toolStatus: "running"`
- **AND** the `toolGroupDefaultCollapsed` display preference is on
- **WHEN** the chat renders
- **THEN** the burst header row SHALL render a Stop control
- **AND** the burst body SHALL remain collapsed

#### Scenario: Header Stop aborts without toggling expansion

- **GIVEN** a collapsed running burst
- **WHEN** the user clicks the header Stop control
- **THEN** exactly one `abort` message SHALL be sent for the session
- **AND** the header SHALL render Force Stop
- **AND** the burst body SHALL remain collapsed

#### Scenario: Force Stop kills and Killing does not toggle

- **GIVEN** a running burst whose header renders Force Stop
- **WHEN** the user clicks Force Stop
- **THEN** exactly one `force_kill` message SHALL be sent for the session
- **AND** the header SHALL render a disabled Killing state
- **AND** the burst body's expanded state SHALL be unchanged

#### Scenario: Expanded running member row shares the header state

- **GIVEN** an expanded burst with two completed members and one member with `toolStatus: "running"`
- **WHEN** the user clicks the running row's Stop control
- **THEN** exactly one `abort` message SHALL be sent
- **AND** both the header and the running row SHALL render Force Stop
- **AND** the completed rows SHALL render no stop control

#### Scenario: Shared state survives collapse and re-expand

- **GIVEN** a running burst in the `killing` state, expanded
- **WHEN** the user collapses and re-expands the burst body while the member is still running
- **THEN** the running row SHALL render the Killing state, not Stop

#### Scenario: Controls disappear when the burst completes

- **GIVEN** a running burst in the `aborting` state
- **WHEN** the running member's `toolStatus` becomes `complete` or `error`
- **THEN** no stop control SHALL render in the header or any row

#### Scenario: Mobile stop target is at least 44px

- **GIVEN** a mobile viewport and a collapsed running burst
- **WHEN** the chat renders
- **THEN** the header stop control's own bounding box SHALL be at least 44×44 CSS px
