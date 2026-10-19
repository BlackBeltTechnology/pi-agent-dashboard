## MODIFIED Requirements

### Requirement: Bridge status fetch and refresh

The settings panel SHALL retrieve bridge status from the `/api/flows-anthropic-bridge/status` endpoint and expose a manual refresh control. The panel SHALL NOT render a heading or id chip repeating the plugin's display name or id, and SHALL NOT draw its own bordered card inside the host card.

#### Scenario: Initial load fetches status

- **WHEN** the settings panel mounts
- **THEN** it SHALL issue a GET request to `/api/flows-anthropic-bridge/status`
- **AND** read the response `sessions` array
- **AND** sort the sessions in ascending order by `pid` before rendering

#### Scenario: Loading state before the first response

- **WHEN** the first status request has not settled yet
- **THEN** the panel SHALL show an info notice reading "Checking sessions…"
- **AND** SHALL NOT show the "no sessions" message until the request has settled with an empty list

#### Scenario: Manual refresh

- **WHEN** the user activates the Refresh control
- **THEN** the panel SHALL re-fetch `/api/flows-anthropic-bridge/status` and update the displayed sessions
- **AND** disable the Refresh control and show a busy state while the request is in flight, keeping its "Refresh" accessible name (the former "…" label replacement is removed)
- **AND** the control SHALL keep the accessible name "Refresh" throughout

#### Scenario: Fetch failure preserves prior state

- **WHEN** the status fetch throws or fails
- **THEN** the panel SHALL retain the previously loaded session list unchanged
- **AND** clear the refreshing state so the Refresh control becomes usable again
- **AND** show a one-sentence error notice stating the status could not be refreshed, with a "Try again" action and any raw detail only behind "Copy details"

#### Scenario: No identity header

- **WHEN** the panel renders
- **THEN** no heading in the body SHALL equal the plugin's display name, and the literal id `flows-anthropic-bridge` SHALL NOT appear as body text

### Requirement: Aggregate status banner

The panel SHALL display a single status notice summarizing bridge health across all reporting sessions, with its tone reflecting the aggregate state and carrying the Refresh control. The notice SHALL use the shared severity tones (never hard-coded colours), SHALL carry an icon plus text so tone is never the only signal, SHALL be announced as a status region, and SHALL be readable in light and dark themes.

#### Scenario: No sessions reporting

- **WHEN** the session list is empty after the status request settled
- **THEN** the notice SHALL use the info tone with a message that no pi session has reported yet and to start a session to see the bridge status
- **AND** no per-session status table SHALL be rendered

#### Scenario: All sessions active

- **WHEN** at least one session is present and every session has `status` equal to `active`
- **THEN** the notice SHALL use the success tone with a message that the bridge is active in all sessions, naming the session count

#### Scenario: One or more peers unavailable

- **WHEN** at least one session is present and any session has a `status` other than `active`
- **THEN** the notice SHALL use the warning tone with a message naming how many of the sessions are not active and that the bridge is off there

### Requirement: Per-PID peer-probe status table

When sessions are present, the panel SHALL render a read-only table with one row per reporting pi PID showing each session's bridge status and per-peer probe results as word pills. Raw status enum values and bare ✓/✗ glyphs SHALL NOT be shown.

#### Scenario: Table rows per session

- **WHEN** the session list is non-empty
- **THEN** the panel SHALL render a table with columns "Session process", "Bridge", `@pi/anthropic-messages`, and `pi-flows`
- **AND** render one row per session keyed by its `pid` (testid `flows-anthropic-bridge-session-<pid>` preserved)
- **AND** display the session's `pid` as code in the first column

#### Scenario: Bridge status as a word pill

- **WHEN** a row renders a session's `status`
- **THEN** the Bridge cell SHALL show a pill with a human word: `active` → "Active" (success tone), `waiting_peers` → "Waiting for peers" (warning tone), `degraded` → "Degraded" (warning tone), `probing` → "Checking" (info tone)
- **AND** the raw enum value SHALL NOT be shown

#### Scenario: Peer probe passed

- **WHEN** a session's peer entry for `@pi/anthropic-messages` or `pi-flows` has `ok` true
- **THEN** the corresponding peer cell SHALL display a success-tone pill reading "Loaded"

#### Scenario: Peer probe failed

- **WHEN** a session's peer entry for `@pi/anthropic-messages` or `pi-flows` has `ok` false or is absent
- **THEN** the corresponding peer cell SHALL display an error-tone pill reading "Missing"
- **AND** show the peer's `reason` as supporting text when one is provided

### Requirement: Env-var gate-override toggles

The panel SHALL expose one three-way control labelled "Bridge gate" with options "Automatic", "Always on" and "Off", exposed as a radio group, mapped onto the bridge's two canonical-gate config keys: Automatic = `forceCanonical` false and `disableCanonical` false; Always on = `forceCanonical` true, `disableCanonical` false; Off = `forceCanonical` false, `disableCanonical` true. The env var names SHALL appear only in the control's hint as code, never in the option labels. Edits SHALL be held as a draft registered with the host Save bar (draft id `plugin:flows-anthropic-bridge`) and persisted only when the user saves from the host Save bar; the panel SHALL NOT render its own Save button. The existing testids `flows-anthropic-bridge-force` and `flows-anthropic-bridge-disable` SHALL mark the "Always on" and "Off" options.

#### Scenario: Toggles reflect persisted config

- **WHEN** the panel renders or the plugin config changes
- **THEN** the "Bridge gate" SHALL select "Automatic" when both `forceCanonical` and `disableCanonical` are false
- **AND** select "Always on" when only `forceCanonical` is true
- **AND** select "Off" when only `disableCanonical` is true

#### Scenario: Force-enable toggle

- **WHEN** the user selects "Always on"
- **THEN** the panel SHALL set the draft to `forceCanonical` true and `disableCanonical` false
- **AND** the hint SHALL state that it forces the bridge for every Anthropic Messages model and sets `PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL`

#### Scenario: Disable toggle

- **WHEN** the user selects "Off"
- **THEN** the panel SHALL set the draft to `forceCanonical` false and `disableCanonical` true
- **AND** the hint SHALL state that it turns the bridge off in every session and sets `PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL`

#### Scenario: Automatic gate

- **WHEN** the user selects "Automatic"
- **THEN** the panel SHALL set the draft to `forceCanonical` false and `disableCanonical` false
- **AND** the hint SHALL state that the bridge turns on only when both `@pi/anthropic-messages` and `pi-flows` load in a session

#### Scenario: Contradictory persisted state

- **WHEN** the loaded config has both `forceCanonical` and `disableCanonical` true
- **THEN** the "Bridge gate" SHALL select no option and a warning notice SHALL state that both overrides are set, which is contradictory, and ask the user to pick one
- **AND** the host Save bar SHALL NOT change either flag until the user picks an option

#### Scenario: Changing the gate marks the host Save bar dirty

- **WHEN** the user selects a gate option different from the persisted one
- **THEN** the host Save bar SHALL show unsaved changes
- **AND** no config write SHALL happen until the user saves

#### Scenario: Saving the draft

- **WHEN** the user saves from the host Save bar
- **THEN** the panel SHALL send a `plugin_config_write` message with id `flows-anthropic-bridge` and a config payload carrying the `forceCanonical` and `disableCanonical` values mapped from the selected gate option
- **AND** no in-body Save control SHALL exist
