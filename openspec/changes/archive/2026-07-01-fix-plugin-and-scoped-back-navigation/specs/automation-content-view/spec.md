## ADDED Requirements

### Requirement: Automation overlay routes SHALL declare back-navigation depth

The Automations plugin's two `shell-overlay-route` claims SHALL declare a `depth` (and `parentPath` where applicable) so the shell's global depth-aware back action resolves them instead of treating them as the card list (depth 0) and no-opping.

- The board route `/folder/:encodedCwd/automations` SHALL declare `depth: 1`. Its back target SHALL be `/` (cards).
- The run-monitor route `/automation/run/:sid` SHALL declare `depth: 2` and `parentPath: "/folder/:encodedCwd/automations"`. Because the run URL cannot supply `:encodedCwd`, `computeParent` degrades to `/`; the run monitor's back SHALL instead return to its **launching route** via the shell's tracked-predecessor `history.back()` fast-path — the board when opened from the board, the session when opened from a session.

The board and run-monitor back controls SHALL continue to invoke the shell-provided `onBack` callback; no plugin-local back logic SHALL be added. Because these routes are reached via wouter's raw `useLocation` (a direct history mutation that bypasses the app's wrapped `navigate`), the nav tracker's `history.pushState`/`replaceState` observation is what records the launching route so the fast-path can return to it (see `url-routing`).

#### Scenario: Board back returns to cards
- **GIVEN** the user opened the Automations board at `/folder/<encoded cwd>/automations`
- **WHEN** the user activates the board back control
- **THEN** the app SHALL navigate to `/` (cards)
- **AND** the back control SHALL NOT be a no-op

#### Scenario: Run monitor back returns to the board it was opened from
- **GIVEN** the user opened a run monitor at `/automation/run/<sid>` from the board for cwd `/Users/u/proj` (a raw `history.pushState` recorded by the tracker)
- **WHEN** the user activates the depth-aware back action
- **THEN** the shell SHALL invoke `window.history.back()` returning to `/folder/<encoded /Users/u/proj>/automations`
- **AND** SHALL NOT navigate to `/` or to an unrelated route

#### Scenario: Run monitor back returns to the launching session
- **GIVEN** the user opened a run monitor at `/automation/run/<sid>` directly from a session `/session/abc` (depth 1)
- **WHEN** the user activates the depth-aware back action
- **THEN** the shell SHALL invoke `window.history.back()` returning to `/session/abc`
- **AND** SHALL NOT navigate to `/` or to the board

#### Scenario: Legacy manifest without depth still backs to cards
- **GIVEN** an automation manifest whose `shell-overlay-route` board claim omits `depth`
- **WHEN** the user activates the board back control
- **THEN** the route SHALL resolve to `depth 2` by default and the back action SHALL navigate to `/`
- **AND** the back control SHALL NOT be a dead no-op
