## Purpose

Automatically resumes ended sessions when the user sends a prompt, queuing the prompt server-side and forwarding it once the session reconnects.

## Requirements

### Requirement: Auto-resume on prompt to ended session
When the server receives a `send_prompt` message for a session with status `"ended"`, it SHALL automatically initiate a resume (continue mode) instead of silently dropping the prompt.

#### Scenario: Prompt sent to ended session with session file
- **WHEN** the server receives `send_prompt` for a session with `status === "ended"` and a valid `sessionFile`
- **THEN** the server SHALL store the prompt in the `PendingResumeRegistry` keyed by the session's `cwd`
- **AND** set `resuming: true` on the old session and broadcast `session_updated`
- **AND** spawn pi with `pi --session <sessionFile>` in continue mode (reuses same session ID)

#### Scenario: Prompt sent to ended session without session file
- **WHEN** the server receives `send_prompt` for a session with `status === "ended"` and no `sessionFile`
- **THEN** the server SHALL log an error and NOT attempt to resume
- **AND** the prompt SHALL be dropped (same as current behavior)

#### Scenario: Prompt sent to active session
- **WHEN** the server receives `send_prompt` for a session with `status !== "ended"`
- **THEN** the server SHALL forward the prompt to the bridge as normal (no auto-resume logic)

### Requirement: Pending resume registry
The server SHALL maintain a `PendingResumeRegistry` that queues prompts for ended sessions being resumed.

#### Scenario: Registry entry structure
- **WHEN** a pending resume is recorded
- **THEN** the entry SHALL contain the prompt `text`, optional `images`, the `oldSessionId`, the `sessionFile`, and a 30-second expiry timer

#### Scenario: Registry keyed by cwd
- **WHEN** a pending resume is recorded for a session with a given `cwd`
- **THEN** the entry SHALL be stored with the `cwd` as the key
- **AND** any previous entry for the same `cwd` SHALL be overwritten (its timer cleared)

#### Scenario: Expiry timeout
- **WHEN** 30 seconds pass without the pending resume being consumed
- **THEN** the entry SHALL be deleted
- **AND** the `resuming` flag on the old session SHALL be cleared to `false`
- **AND** `session_updated` SHALL be broadcast to restore the card to normal ended state

### Requirement: Prompt flush on bridge reconnection
When a new session registers via `session_register`, the server SHALL check the `PendingResumeRegistry` for a matching entry and forward the queued prompt.

#### Scenario: New session registers with matching cwd
- **WHEN** a new session sends `session_register` with a `cwd` that has a pending resume entry
- **THEN** the server SHALL consume the entry and send the queued prompt (text + images) to the new session via `piGateway.sendToSession()`

#### Scenario: No matching pending resume
- **WHEN** a new session sends `session_register` with a `cwd` that has no pending resume entry
- **THEN** the server SHALL proceed normally without any prompt forwarding

### Requirement: Clear resuming flag on successful flush
When a pending resume is successfully flushed, the server SHALL clear the resuming state. Since `pi --session` reuses the same session ID, the session transitions in-place — no hiding or navigation is needed.

#### Scenario: Resuming flag cleared after flush
- **WHEN** the pending resume prompt is successfully forwarded to the session
- **THEN** the server SHALL set `resuming: false` on the session
- **AND** broadcast `session_updated` with `{ resuming: false }`

### Requirement: Double-send guard
If the user sends another prompt while auto-resume is already in progress, the server SHALL update the queued prompt without spawning a second process.

#### Scenario: Prompt sent while already resuming
- **WHEN** the server receives `send_prompt` for a session with `resuming === true`
- **THEN** the server SHALL overwrite the pending prompt in the registry
- **AND** SHALL NOT spawn a second pi process

### Requirement: Manual resume blocked during auto-resume
If a session is already being auto-resumed, the server SHALL reject manual resume requests.

#### Scenario: Manual resume while auto-resuming
- **WHEN** the server receives `resume_session` for a session with `resuming === true`
- **THEN** the server SHALL return a `resume_result` with `success: false` and message "Session is already being resumed"

### Requirement: Spawn failure handling
When the resume spawn fails, the server SHALL clean up the pending state.

#### Scenario: Spawn returns failure
- **WHEN** `spawnPiSession` returns `success: false` for an auto-resume attempt
- **THEN** the server SHALL remove the entry from the `PendingResumeRegistry`
- **AND** clear the `resuming` flag on the old session
- **AND** broadcast `session_updated` to restore the card to normal ended state


### Requirement: Auto-resume tags front intent so card surfaces
When the server's `handleSendPrompt` detects `status === "ended"` and triggers an auto-resume, it SHALL tag `pendingResumeIntents.record(sessionId, "front")` BEFORE calling `spawnPiSession`. The user is actively interacting with the session by typing into it; the resumed card SHALL surface at the top of the alive tier.

This requirement closes a gap in the prior spec: the prompt-auto-resume path queued the prompt and spawned the pi process but did not participate in the ordering contract, leaving the resumed session in its previous (often mid-bucket) position.

#### Scenario: Prompt to ended session surfaces card at top
- **WHEN** the user types a prompt and submits it for an ended session "s1" that is not currently at index 0 of `sessionOrder`
- **THEN** before `spawnPiSession`, the server SHALL call `pendingResumeIntents.record("s1", "front")`
- **AND** when the bridge re-registers "s1" and the ended→alive transition fires, the server SHALL move "s1" to the front of `sessionOrder`
- **AND** the server SHALL broadcast `sessions_reordered` with the new order

#### Scenario: Prompt to ended session without sessionFile does not tag intent
- **WHEN** an ended session has no `sessionFile` and the user submits a prompt to it
- **THEN** the server SHALL NOT call `pendingResumeIntents.record` (because no resume is attempted; the prompt is dropped per existing behavior)

#### Scenario: Multiple rapid prompts to ended session do not duplicate tags
- **WHEN** the user submits two prompts in quick succession to ended session "s1" before the first auto-resume completes
- **THEN** the second `handleSendPrompt` invocation SHALL early-return on the existing `alreadyResuming` guard
- **AND** the second call SHALL NOT re-tag the registry (the first tag is sufficient and still within TTL)
