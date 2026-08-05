## REMOVED Requirements

### Requirement: Retry action on error banner

**Reason:** the behavior this requirement describes no longer exists in the code and cannot be
reinstated. `simplify-error-retry-single-card` removed the control because re-sending the last
user-authored prompt via `send_prompt` appended a duplicate user turn to the transcript; the
deployed spec was never synced and still describes the removed `send_prompt` re-send and the
also-removed `limit-exceeded` sub-state. The orphaned `findLastUserPrompt` helper survives in
`event-reducer.ts` with no callers in `src/`.

Replacing it with a non-duplicating re-drive was scoped into this change and then dropped:
there is no mechanism. `resume mode:"continue"` is refused for a live session
(`resume.already_active`, `session-action-handler.ts`) and merely reopens an ended one idle
(`pi --session <file>`); no bridge command to continue a turn exists; and pi's
`ExtensionContext` exposes no `continue()`.

**Migration:** the retry need this served is met by pi's own retry budget, now configurable via
the `pi-retry-settings` capability. A settled error is genuinely settled; the surface offers
Copy and a state-clearing dismiss.

## MODIFIED Requirements

### Requirement: Error state cleared on confirmed-good response

`SessionState.lastError` SHALL persist across the start of a retry or continuation turn and
SHALL clear only on a confirmed non-error response for the session. A settled error whose retry
chain is still running SHALL NOT be presented as terminal: while a `retry` sub-status is
carried the surface SHALL present a pending retry, and the error anchor SHALL remain as its
header.

Because pi fires one `agent_end` per retry attempt, an `agent_end` carrying an error SHALL NOT
by itself be treated as the end of the lifecycle; only `agent_settled` terminates it.

#### Scenario: Error persists while a retry is pending

- **GIVEN** `lastError` is set AND a `retry` sub-status is carried
- **WHEN** the next attempt starts
- **THEN** `lastError` SHALL remain set
- **AND** the surface SHALL continue to show the error text as the card header

#### Scenario: Error clears on a confirmed non-error response

- **WHEN** a turn for the session completes with a non-error stop reason
- **THEN** `SessionState.lastError` SHALL be cleared
- **AND** the surface SHALL become hidden once `retryState` is also undefined

#### Scenario: The error persists when retries run out

- **GIVEN** pi has exhausted `retry.maxRetries` and the chain terminated with an error
- **WHEN** `agent_settled` clears the retry sub-status
- **THEN** `SessionState.lastError` SHALL remain set
- **AND** the surface SHALL remain visible as a settled error, with a state-clearing dismiss
- **AND** the message SHALL NOT auto-hide when retrying stops

#### Scenario: A retrying chain is not presented as terminal

- **GIVEN** an attempt ended with an error AND a further attempt is pending
- **THEN** the surface SHALL render the pending-retry presentation (Stop retrying, attempt,
  countdown)
- **AND** the surface SHALL NOT render the settled presentation (clearing dismiss)
