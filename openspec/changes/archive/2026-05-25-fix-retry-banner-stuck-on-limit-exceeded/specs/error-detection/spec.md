## MODIFIED Requirements

### Requirement: Retry action on error banner

The error banner SHALL render a Retry control when the host view supplies a retry handler. Clicking Retry SHALL re-send the last user-authored prompt for the session via a `send_prompt` message (text + images), so an alive-but-errored session re-runs the same input that originally triggered the failure.

The host view SHALL identify the last user-authored message via a helper that walks `state.messages` newest-to-oldest and returns the first user message's `text` and `images`. When no user message exists in history, the Retry button MAY be hidden or be a no-op.

This replaces the prior `resume_session{mode:"continue"}` behavior, which no-ops on alive-but-errored sessions because the server short-circuits with "Session is already active".

#### Scenario: Retry button re-sends last user prompt

- **GIVEN** the error banner is visible for a session with `lastError` set
- **AND** a retry handler is wired (in App.tsx) that calls `findLastUserPrompt(state.messages)` and then `handleSendPromptToSession(selectedId, text, images)`
- **AND** the session history contains at least one user message with text `"please refactor X"` and no images
- **WHEN** the user clicks the Retry button
- **THEN** a `send_prompt` message SHALL be sent to the server for that session with `text: "please refactor X"` and no `images`
- **AND** when the resulting `agent_start` event arrives the reducer SHALL clear both `lastError` and `retryState`

#### Scenario: Retry button hidden when no handler is provided

- **WHEN** the error banner is rendered without an `onRetry` callback
- **THEN** no Retry button SHALL be rendered

#### Scenario: Retry button no-op when no prior user prompt exists

- **GIVEN** the error banner is visible for a session whose history contains no user-authored messages (defensive edge case)
- **WHEN** the user clicks the Retry button
- **THEN** no `send_prompt` SHALL be sent
- **AND** the banner SHALL remain visible
