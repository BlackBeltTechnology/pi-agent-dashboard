# flows-anthropic-bridge-settings Specification

## Purpose

Provide a dashboard settings panel for the pi-flows Anthropic Messages Bridge plugin. The panel fetches per-PID bridge peer-probe status, renders a status table summarizing each reporting pi session's peer resolution, surfaces an aggregate health banner, and exposes two persisted env-var gate-override toggles that control whether the bridge is force-enabled or disabled.

## Requirements

### Requirement: Bridge status fetch and refresh

The settings panel SHALL retrieve bridge status from the `/api/flows-anthropic-bridge/status` endpoint and expose a manual refresh control.

#### Scenario: Initial load fetches status

- **WHEN** the settings panel mounts
- **THEN** it SHALL issue a GET request to `/api/flows-anthropic-bridge/status`
- **AND** read the response `sessions` array
- **AND** sort the sessions in ascending order by `pid` before rendering

#### Scenario: Manual refresh

- **WHEN** the user activates the Refresh control
- **THEN** the panel SHALL re-fetch `/api/flows-anthropic-bridge/status` and update the displayed sessions
- **AND** disable the Refresh control while the request is in flight
- **AND** display a loading indicator ("…") in place of the "Refresh" label until the request settles

#### Scenario: Fetch failure preserves prior state

- **WHEN** the status fetch throws or fails
- **THEN** the panel SHALL retain the previously loaded session list unchanged
- **AND** clear the refreshing state so the Refresh control becomes usable again

### Requirement: Aggregate status banner

The panel SHALL display a single banner summarizing bridge health across all reporting sessions, with tone reflecting the aggregate state.

#### Scenario: No sessions reporting

- **WHEN** the session list is empty
- **THEN** the banner SHALL show a muted-tone message indicating no pi sessions are reporting yet and to start a pi session to see status
- **AND** no per-session status table SHALL be rendered

#### Scenario: All sessions active

- **WHEN** at least one session is present and every session has `status` equal to `active`
- **THEN** the banner SHALL show an ok-tone message indicating the bridge is active in all pi sessions

#### Scenario: One or more peers unavailable

- **WHEN** at least one session is present and any session has a `status` other than `active`
- **THEN** the banner SHALL show a warn-tone message indicating one or more peers are unavailable and to see per-session detail below

### Requirement: Per-PID peer-probe status table

When sessions are present, the panel SHALL render a table with one row per reporting pi PID showing each session's status and per-peer probe results.

#### Scenario: Table rows per session

- **WHEN** the session list is non-empty
- **THEN** the panel SHALL render a table with columns for PID, Status, `@pi/anthropic-messages`, and `pi-flows`
- **AND** render one row per session keyed by its `pid`
- **AND** display the session's `pid` and `status` values in their columns

#### Scenario: Peer probe passed

- **WHEN** a session's peer entry for `@pi/anthropic-messages` or `pi-flows` has `ok` true
- **THEN** the corresponding peer cell SHALL display a check mark ("✓")

#### Scenario: Peer probe failed

- **WHEN** a session's peer entry for `@pi/anthropic-messages` or `pi-flows` has `ok` false or is absent
- **THEN** the corresponding peer cell SHALL display a cross mark ("✗") followed by the peer's `reason`
- **AND** substitute a default "missing" text when no `reason` is provided

### Requirement: Env-var gate-override toggles

The panel SHALL expose two checkbox toggles that map to the bridge's canonical-gate env vars, editable as a local draft and persisted only on explicit save.

#### Scenario: Toggles reflect persisted config

- **WHEN** the panel renders or the plugin config changes
- **THEN** the "Force gate open" checkbox SHALL reflect the config `forceCanonical` value
- **AND** the "Disable bridge entirely" checkbox SHALL reflect the config `disableCanonical` value

#### Scenario: Force-enable toggle

- **WHEN** the user toggles the force-enable checkbox
- **THEN** the panel SHALL update the local draft `forceCanonical` state
- **AND** the toggle label SHALL identify it as setting `PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL`

#### Scenario: Disable toggle

- **WHEN** the user toggles the disable checkbox
- **THEN** the panel SHALL update the local draft `disableCanonical` state
- **AND** the toggle label SHALL identify it as setting `PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL`

#### Scenario: Saving the draft

- **WHEN** the user activates the Save control
- **THEN** the panel SHALL send a `plugin_config_write` message with id `flows-anthropic-bridge` and a config payload carrying the current draft `forceCanonical` and `disableCanonical` values
