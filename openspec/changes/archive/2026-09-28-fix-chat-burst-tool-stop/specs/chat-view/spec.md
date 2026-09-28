## ADDED Requirements

### Requirement: Running burst exposes a shared stop control

While a burst group contains a visible member (a member not hidden by the per-tool-kind display preference) whose `toolStatus` is `running` and the chat view supplies an abort handler, the burst SHALL render a stop control in its header row regardless of whether the burst is expanded or collapsed. The burst SHALL own exactly ONE stop state (`idle` → `arming` → `aborting` → `killing`) shared by the header control and by the stop control of every running member row in its body.

Clicking Stop (in `idle`) SHALL send an `abort` message for the session. When a force-kill handler is also supplied, the shared state SHALL move to `arming`, where every control SHALL render a disabled "Stopping…" state for 600 ms, then to `aborting`, where every control SHALL render Force Stop. Without a force-kill handler the control SHALL stay Stop. The arming window prevents the second click of an accidental double-click from landing on Force Stop. Clicking Force Stop SHALL send a `force_kill` message and move the shared state to `killing`, where every control SHALL render a disabled Killing state. The shared state SHALL survive collapsing and re-expanding the burst body; it is not required to survive the burst row being virtualized off-screen. When no visible member is running, no stop control SHALL render, any pending arming timer SHALL be cancelled, and the shared state SHALL reset to `idle`.

Stop and Force Stop controls SHALL be real focusable buttons with an accessible name. The Stopping… and Killing states SHALL be disabled buttons with an accessible name. All stop controls SHALL be placed OUTSIDE the header/row toggle button, so that activating a stop control SHALL NOT toggle the burst's or row's expanded state. The header toggle button SHALL keep its existing `tool-burst-header` test id.

Each state SHALL be distinguishable by glyph shape, not colour alone:

| State | Glyph |
|---|---|
| Stop | square |
| Stopping… | hourglass |
| Force Stop | triangle |
| Killing | spinner |

Stop SHALL use the error severity token family and Force Stop the warning severity token family. The header control SHALL show a visible text label next to the glyph on desktop, and SHALL be glyph-only on mobile viewports. Row controls SHALL be glyph-only. Every control's own hit area SHALL be at least 24×24 CSS px on desktop and at least 44×44 CSS px on mobile viewports.

Rows whose `toolStatus` is not `running` SHALL render no stop control. When the abort handler is absent, no stop control SHALL render.

#### Scenario: Collapsed running burst shows Stop in the header

- **GIVEN** a burst whose only member is a `bash` tool with `toolStatus: "running"`
- **AND** the `toolGroupDefaultCollapsed` display preference is on
- **WHEN** the chat renders
- **THEN** the burst header row SHALL render a Stop control
- **AND** the burst body SHALL remain collapsed

#### Scenario: Header Stop aborts, arms, then offers Force Stop without toggling

- **GIVEN** a collapsed running burst with both handlers
- **WHEN** the user clicks the header Stop control
- **THEN** exactly one `abort` message SHALL be sent for the session
- **AND** the header SHALL render a disabled Stopping… state
- **AND** after 600 ms the header SHALL render Force Stop
- **AND** the burst body SHALL remain collapsed

#### Scenario: Double-click on Stop never force-kills

- **GIVEN** a running burst with both handlers
- **WHEN** the user double-clicks the Stop control
- **THEN** exactly one `abort` message SHALL be sent
- **AND** no `force_kill` message SHALL be sent

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
- **AND** both the header and the running row SHALL render the same state (Stopping…, then Force Stop)
- **AND** the completed rows SHALL render no stop control

#### Scenario: Shared state survives collapse and re-expand

- **GIVEN** a running burst in the `killing` state, expanded
- **WHEN** the user collapses and re-expands the burst body while the member is still running
- **THEN** the running row SHALL render the Killing state, not Stop

#### Scenario: Controls disappear when the burst completes

- **GIVEN** a running burst in the `arming` or `aborting` state
- **WHEN** the running member's `toolStatus` becomes `complete` or `error`
- **THEN** no stop control SHALL render in the header or any row
- **AND** no later timer SHALL re-render a Force Stop

#### Scenario: Header label on desktop, glyph-only on mobile

- **GIVEN** a running burst with both handlers
- **WHEN** the chat renders on a desktop viewport
- **THEN** the header stop control SHALL show the visible text "Stop"
- **WHEN** the chat renders on a mobile viewport
- **THEN** the header stop control SHALL show no visible text, SHALL keep its accessible name, and its own bounding box SHALL be at least 44×44 CSS px
