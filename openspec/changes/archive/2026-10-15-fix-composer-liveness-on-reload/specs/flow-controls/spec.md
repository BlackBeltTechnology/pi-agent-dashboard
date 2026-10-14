## MODIFIED Requirements

### Requirement: Stop after turn — graceful exit at next turn boundary

Sessions SHALL support a graceful "stop after turn" affordance distinct from the existing `abort` (mid-stream interrupt) and `force_kill` (SIGKILL). When the user requests stop-after-turn:

1. The browser SHALL send `{ type: "stop_after_turn", sessionId }` over the WS.
2. The server SHALL forward the message to the bridge owning that session via `piGateway.sendToSession`.
3. The bridge SHALL set a per-session flag (`shouldStopAfterTurn = true`) and, on the NEXT `turn_end` event from pi, SHALL invoke `cachedCtx.shutdown()` (graceful) — falling back to `cachedCtx.abort()` only if `shutdown` is unavailable. The flag SHALL be cleared after the shutdown call.
4. Repeated `stop_after_turn` messages while the flag is already set SHALL be no-ops.

This affordance SHALL coexist with `abort` and `force_kill`. None replaces another.

The UI SHALL render a "Stop after turn" button alongside the existing Abort button, visible exactly when the Stop control's working condition holds: the reconciled composer liveness (the server-held session status when the server holds one, with `idle` / `active` read as `idle`; else the event-derived chat status) is `streaming`, OR an LLM-provider retry is recorded (`SessionState.retryState` set) AND the reconciled liveness is not `ended`. The two controls therefore appear and disappear together, including during a retry gap where the reconciled liveness reads `idle`. After click, the button SHALL be optimistically disabled with a "stopping after this turn…" pill displayed alongside, until the reconciled liveness leaves `streaming` (driven by the next `agent_end` / `session_removed`, or by the server-held status).

#### Scenario: User clicks Stop after turn mid-stream
- **WHEN** the agent is streaming and the user clicks "Stop after turn"
- **THEN** the bridge SHALL set the per-session flag and let the current turn complete
- **AND** at `turn_end`, the bridge SHALL call `cachedCtx.shutdown()`, ending the session cleanly
- **AND** the dashboard SHALL show no aborted-tool indicators or truncated assistant messages from this turn

#### Scenario: Stop after turn offered on a reload-recovered run
- **GIVEN** the event-derived chat status reads `idle` because the run's start was not re-delivered after a reload
- **WHEN** the server-held status for the session is `streaming`
- **THEN** the "Stop after turn" button SHALL be rendered alongside the Stop control
- **AND** clicking it SHALL send the same `stop_after_turn` message, with no protocol or bridge-side difference

#### Scenario: Stop after turn follows the Stop control during a retry gap
- **GIVEN** `SessionState.retryState` is set and the server-held status is `idle`
- **WHEN** the composer is rendered
- **THEN** the "Stop after turn" button SHALL be rendered alongside the Stop control

#### Scenario: Stop after turn hidden on a server-ended session in retry
- **GIVEN** `SessionState.retryState` is still set
- **WHEN** the server-held status for the session is `ended`
- **THEN** neither the "Stop after turn" button nor the Stop control SHALL be rendered

#### Scenario: Stop after turn is idempotent
- **WHEN** the user clicks the button twice in rapid succession
- **THEN** the second click SHALL be a no-op (flag already set; bridge does not double-shutdown)

#### Scenario: Falls back when shutdown is unavailable
- **WHEN** `cachedCtx.shutdown` is not a function (e.g. older pi or a session in a state where shutdown isn't valid)
- **THEN** the bridge SHALL call `cachedCtx.abort()` instead and log a warning, preserving the session's clean termination intent at best-effort

#### Scenario: Force Kill still preempts
- **WHEN** the user has a stop-after-turn pending AND clicks Force Kill
- **THEN** the SIGKILL path SHALL run unchanged; the flag is irrelevant after the process is dead

#### Scenario: Optimistic pill does not clear while the server still reports the run
- **GIVEN** the user has clicked "Stop after turn" and the "stopping after this turn…" pill is shown
- **WHEN** the event-derived chat status leaves `streaming` but the server-held status is still `streaming`
- **THEN** the pill SHALL remain displayed
