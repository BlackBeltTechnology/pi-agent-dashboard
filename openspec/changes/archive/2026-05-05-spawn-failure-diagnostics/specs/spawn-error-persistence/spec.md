## ADDED Requirements

### Requirement: Spawn error banner renders failure code as actionable hint
The spawn-error banner component SHALL render an actionable hint sourced from the `code` field of the `spawn_error` message. Each known code SHALL map to a short user-facing label and (where applicable) a CTA button. Unknown or missing codes SHALL fall back to the existing message-only display.

Code → hint mapping (label + optional CTA):
- `DIR_MISSING` — "Folder no longer exists." (no CTA)
- `PI_NOT_FOUND` — "Pi binary not found." → CTA: "Open Setup Wizard"
- `WIN_PI_CMD_ONLY` — "Windows install incomplete (only pi.cmd found)." → CTA: "Open Setup Wizard"
- `WT_MISSING` — "Windows Terminal not installed." (no CTA)
- `TMUX_MISSING` — "tmux not installed." (no CTA)
- `PI_CRASHED` — "Pi exited immediately. See log below." (no CTA)
- `SPAWN_ERRNO` — "OS refused to start pi. See message." (no CTA)
- `PREFLIGHT_FAILED` — "Preflight checks failed." → renders `reasons` list
- `REGISTER_TIMEOUT` — "Pi started but never connected to the dashboard." → CTA: "View log"

#### Scenario: known code shows hint
- **WHEN** a `spawn_error` with `code: "PI_NOT_FOUND"` arrives
- **THEN** the banner SHALL display the label "Pi binary not found." and a CTA button "Open Setup Wizard"

#### Scenario: unknown code falls back to message
- **WHEN** a `spawn_error` with an unrecognized `code` arrives
- **THEN** the banner SHALL display the `message` field unchanged (existing behavior)

#### Scenario: missing code falls back to message
- **WHEN** a `spawn_error` with no `code` field arrives (legacy server)
- **THEN** the banner SHALL display the `message` field unchanged

### Requirement: Spawn error banner renders stderr tail in collapsed details
When `spawn_error.stderr` is non-empty, the banner SHALL render it inside a collapsed `<details>` block labelled "Pi stderr" using a monospace font. The block SHALL NOT be expanded by default.

#### Scenario: stderr present
- **WHEN** a `spawn_error` arrives with a non-empty `stderr`
- **THEN** the banner SHALL include a `<details>` element with summary "Pi stderr" and the `stderr` content as preformatted text

#### Scenario: stderr absent
- **WHEN** a `spawn_error` arrives without `stderr`
- **THEN** no `<details>` block SHALL be rendered

### Requirement: Spawn register timeout shown as distinct banner
When a `spawn_register_timeout` browser message arrives, a distinct banner SHALL be shown for the originating `cwd` with the label "Pi started (PID N) but never connected to the dashboard within Ts." where T is the configured `spawnRegisterTimeoutMs` divided by 1000 (rendered with no trailing zeros, e.g. "30s"). When `pid` is absent (tmux/wt/wsl-tmux), the label SHALL omit the `(PID N)` segment. The banner SHALL include the `stderrTail` (if present) inside a collapsed `<details>` block labelled "Pi stderr". The banner SHALL be dismissible like other spawn-error banners and SHALL be cleared by either (a) a subsequent successful spawn for the same `cwd`, or (b) a `spawn_register_recovered` message for the same `cwd`.

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
