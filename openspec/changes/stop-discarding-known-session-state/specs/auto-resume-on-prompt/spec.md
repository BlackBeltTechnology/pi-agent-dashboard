# auto-resume-on-prompt Specification

## MODIFIED Requirements

### Requirement: Auto-resume on prompt to ended session

When the server receives a `send_prompt` message for a session with status
`"ended"`, it SHALL automatically initiate a resume (continue mode) instead of
silently dropping the prompt.

When the server cannot act on a `send_prompt` — no `sessionFile`, or no bridge
connection on the live path — it SHALL emit user-visible command feedback for
that session. A server-side `console.error` is not a user-visible outcome: the
browser receives nothing, and the client's 30-second safety timeout then
attributes the failure to the session rather than to the server's refusal.

#### Scenario: Prompt sent to ended session with session file

- **WHEN** the server receives `send_prompt` for a session with `status === "ended"` and a valid `sessionFile`
- **THEN** the server SHALL store the prompt in the `PendingResumeRegistry` keyed by the session's `cwd`
- **AND** set `resuming: true` on the old session and broadcast `session_updated`
- **AND** spawn pi with `pi --session <sessionFile>` in continue mode (reuses same session ID)

#### Scenario: Prompt sent to ended session without session file

- **WHEN** the server receives `send_prompt` for a session with `status === "ended"` and no `sessionFile`
- **THEN** the server SHALL NOT attempt to resume
- **AND** the server SHALL emit command feedback identifying the session as not
  resumable because it has no session file
- **AND** the prompt SHALL NOT be silently dropped

#### Scenario: Prompt sent to active session

- **WHEN** the server receives `send_prompt` for a session with `status !== "ended"`
- **THEN** the server SHALL forward the prompt to the bridge as normal (no auto-resume logic)

#### Scenario: Prompt to an active session with no bridge connection

- **GIVEN** a session whose status is not `"ended"` but whose bridge connection is gone
- **WHEN** the server forwards the prompt and the send reports failure
- **THEN** the server SHALL emit command feedback indicating the prompt was not delivered to the session
- **AND** the client SHALL NOT have to infer the failure from the 30-second safety timeout

### Requirement: Spawn failure handling

When the resume spawn fails, the server SHALL roll back the optimistic state it
set, and SHALL report the failure to the user rather than only to the log.

#### Scenario: Spawn returns failure

- **WHEN** `spawnPiSession` returns a failure result during auto-resume
- **THEN** the pending resume entry for that `cwd` SHALL be consumed (removed)
- **AND** `resuming` SHALL be set back to `false` and `session_updated` broadcast
- **AND** the server SHALL emit command feedback carrying the spawn failure reason
