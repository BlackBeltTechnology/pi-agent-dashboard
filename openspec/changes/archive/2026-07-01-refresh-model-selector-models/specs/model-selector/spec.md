## ADDED Requirements

### Requirement: User-initiated model list refresh

The model selector dropdown SHALL provide a refresh control in its footer that re-requests the available model list for the currently selected session. Activating the control SHALL send a `request_models` message scoped to the selected session, deliberately bypassing the client's "fetch once per session" guard (`!modelsMap.has(sessionId)`), so a live session can pull a fresh list on demand. The resulting `models_list` push SHALL update the dropdown through the existing per-session update path.

The control SHALL show a transient busy indicator from activation until either a `models_list` for the selected session arrives or a short safety timeout elapses, after which it returns to its idle state.

The `onRefresh` capability SHALL be an optional prop on the selector; when absent (e.g. no session selected, or a host that does not provide it) the footer refresh control SHALL NOT render, preserving backward compatibility for the registered UI primitive.

#### Scenario: Refresh a stale list mid-session

- **WHEN** a session is live and the user opens the model dropdown and activates the refresh control
- **THEN** the client sends `request_models` for the selected session
- **AND** the control enters a busy state
- **AND** on receipt of the `models_list` for that session the dropdown shows the updated models and the control returns to idle

#### Scenario: Refresh bypasses the fetch-once guard

- **WHEN** the selected session already has an entry in `modelsMap`
- **AND** the user activates the refresh control
- **THEN** the client still sends `request_models` for that session (the `!modelsMap.has(sessionId)` guard does not suppress the explicit user action)

#### Scenario: Busy state clears on safety timeout

- **WHEN** the refresh control is busy and no `models_list` for the selected session arrives
- **THEN** the busy indicator clears after the safety timeout and the control returns to idle

#### Scenario: No refresh control without a handler

- **WHEN** the selector is rendered without an `onRefresh` handler
- **THEN** the footer refresh control SHALL NOT render
