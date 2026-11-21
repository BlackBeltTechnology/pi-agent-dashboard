## MODIFIED Requirements

### Requirement: Spawn register timeout shown as distinct banner
When a `spawn_register_timeout` browser message arrives, a distinct banner SHALL be shown for the originating `cwd` with the label "Pi started (PID N) but never connected to the dashboard within Ts." (when the message carries `terminated: true` the label SHALL read "Pi started (PID N) but never connected to the dashboard within Ts and was terminated.") where T is the configured `spawnRegisterTimeoutMs` divided by 1000 (rendered with no trailing zeros, e.g. "30s"). When `pid` is absent (tmux/wt/wsl-tmux), the label SHALL omit the `(PID N)` segment. The banner SHALL include the `stderrTail` (if present) inside a collapsed `<details>` block labelled "Pi stderr". The banner SHALL be dismissible like other spawn-error banners and SHALL be cleared by either (a) a subsequent successful spawn for the same `cwd`, or (b) a `spawn_register_recovered` message for the same `cwd`.

#### Scenario: timeout banner displayed
- **WHEN** a `spawn_register_timeout` message arrives with `cwd: "/p/x"` and `pid: 123`
- **THEN** a banner SHALL be displayed for `/p/x` containing the PID and the timeout text

#### Scenario: timeout banner cleared by successful spawn
- **WHEN** a `spawn_register_timeout` banner is visible for `cwd` and a `spawn_result { success: true, cwd }` arrives
- **THEN** the timeout banner SHALL be cleared

#### Scenario: timeout banner cleared by late-register recovery
- **WHEN** a `spawn_register_timeout` banner is visible for `cwd` and a `spawn_register_recovered { cwd }` message arrives
- **THEN** the timeout banner SHALL be cleared automatically (no user dismissal required)

#### Scenario: timeout banner without pid (tmux)
- **WHEN** a `spawn_register_timeout` arrives with `pid` undefined
- **THEN** the banner label SHALL omit the `(PID N)` segment and otherwise render normally

#### Scenario: timeout banner states termination
- **WHEN** a `spawn_register_timeout` arrives with `cwd: "/p/x"`, `pid: 123`, `timeoutMs: 30000` and `terminated: true`
- **THEN** the banner label SHALL read "Pi started (PID 123) but never connected to the dashboard within 30s and was terminated."

#### Scenario: terminated timeout banner without pid
- **WHEN** a `spawn_register_timeout` arrives with `pid` undefined, `timeoutMs: 30000` and `terminated: true`
- **THEN** the banner label SHALL read "Pi started but never connected to the dashboard within 30s and was terminated."

#### Scenario: legacy server message unchanged
- **WHEN** a `spawn_register_timeout` arrives without `terminated`
- **THEN** the banner label SHALL be the existing never-connected text, without the termination clause
