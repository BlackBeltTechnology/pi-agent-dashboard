## Purpose

Per-session flow control affordances: abort a running turn, toggle autonomous mode, gracefully stop after the current turn, and force kill the process.
## Requirements
### Requirement: Abort flow button
The flow dashboard header SHALL include an "Abort" button that sends a `flow_control` message with `action: "abort"` to stop the running flow.

#### Scenario: Abort running flow
- **WHEN** the user clicks the abort button while a flow is running
- **THEN** a `flow_control` message with `action: "abort"` SHALL be sent to the server

#### Scenario: Abort button hidden when no flow running
- **WHEN** no flow is active for the session
- **THEN** the abort button SHALL NOT be displayed

### Requirement: Autonomous mode toggle
The flow dashboard header SHALL include an "Auto" toggle button showing the current autonomous mode state. Clicking it SHALL send a `flow_control` message with `action: "toggle_autonomous"`.

#### Scenario: Toggle autonomous mode on
- **WHEN** autonomous mode is off and the user clicks the Auto toggle
- **THEN** a `flow_control` message with `action: "toggle_autonomous"` SHALL be sent and the toggle SHALL reflect the new state

#### Scenario: Autonomous mode state synchronized
- **WHEN** a `flow_started` event includes `autonomousMode: true`
- **THEN** the Auto toggle SHALL display as active

### Requirement: Stop after turn — graceful exit at next turn boundary

Sessions SHALL support a graceful "stop after turn" affordance distinct from the existing `abort` (mid-stream interrupt) and `force_kill` (SIGKILL). When the user requests stop-after-turn:

1. The browser SHALL send `{ type: "stop_after_turn", sessionId }` over the WS.
2. The server SHALL forward the message to the bridge owning that session via `piGateway.sendToSession`.
3. The bridge SHALL set a per-session flag (`shouldStopAfterTurn = true`) and, on the NEXT `turn_end` event from pi, SHALL invoke `cachedCtx.shutdown()` (graceful) — falling back to `cachedCtx.abort()` only if `shutdown` is unavailable. The flag SHALL be cleared after the shutdown call.
4. Repeated `stop_after_turn` messages while the flag is already set SHALL be no-ops.

This affordance SHALL coexist with `abort` and `force_kill`. None replaces another.

The UI SHALL render a "Stop after turn" button alongside the existing Abort button, visible only while the session is streaming. After click, the button SHALL be optimistically disabled with a "stopping after this turn…" pill displayed alongside, until the next `agent_end` or `session_removed` event clears it.

#### Scenario: User clicks Stop after turn mid-stream
- **WHEN** the agent is streaming and the user clicks "Stop after turn"
- **THEN** the bridge SHALL set the per-session flag and let the current turn complete
- **AND** at `turn_end`, the bridge SHALL call `cachedCtx.shutdown()`, ending the session cleanly
- **AND** the dashboard SHALL show no aborted-tool indicators or truncated assistant messages from this turn

#### Scenario: Stop after turn is idempotent
- **WHEN** the user clicks the button twice in rapid succession
- **THEN** the second click SHALL be a no-op (flag already set; bridge does not double-shutdown)

#### Scenario: Falls back when shutdown is unavailable
- **WHEN** `cachedCtx.shutdown` is not a function (e.g. older pi or a session in a state where shutdown isn't valid)
- **THEN** the bridge SHALL call `cachedCtx.abort()` instead and log a warning, preserving the session's clean termination intent at best-effort

#### Scenario: Force Kill still preempts
- **WHEN** the user has a stop-after-turn pending AND clicks Force Kill
- **THEN** the SIGKILL path SHALL run unchanged; the flag is irrelevant after the process is dead

