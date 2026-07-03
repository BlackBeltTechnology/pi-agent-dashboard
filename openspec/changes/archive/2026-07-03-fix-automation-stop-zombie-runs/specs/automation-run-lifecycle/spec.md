## MODIFIED Requirements

### Requirement: A running run can be stopped by the user

A user SHALL be able to stop a `running` automation run from the board. Stopping SHALL **terminate the run's spawned process** via a trusted host-provided capability on `ServerPluginContext` (gated to trusted plugins like `spawnSession`), and SHALL finalize the run record only after the termination has been attempted. Termination SHALL succeed regardless of run state, including the window after the run record is `running` but before its spawned session has registered — the host capability SHALL accept a `spawnToken` (captured at spawn time) so a not-yet-registered run can be killed by process handle, and SHALL accept a `sessionId` for a registered run. Finalization SHALL be idempotent with the normal `agent_end` capture path: a stopped run SHALL be finalized exactly once, and a subsequent end event for that session SHALL NOT re-finalize or duplicate the record.

#### Scenario: Stop terminates a registered run and finalizes the record

- **WHEN** a user stops a `running` run whose session has registered
- **THEN** the run's process SHALL be terminated via the host capability keyed by its `sessionId` AND the run record SHALL transition out of `running`.

#### Scenario: Stop during the spawn→register window terminates by spawnToken

- **GIVEN** a run whose record is `running` but whose spawned session has not yet registered (no `sessionId` bound)
- **WHEN** a user stops the run
- **THEN** the run's process SHALL be terminated via the host capability keyed by its `spawnToken`
- **AND** the run record SHALL be finalized
- **AND** no orphaned/never-signaled session SHALL remain after the spawned session finishes registering.

#### Scenario: A no-op soft abort does not silently finalize a live run

- **WHEN** stopping a run and the soft turn-abort cannot be delivered (e.g. the bridge WebSocket is not open)
- **THEN** the stop SHALL still terminate the process via the host kill capability rather than finalizing the record while the process keeps running.

#### Scenario: Stop is idempotent with agent_end

- **WHEN** a stopped run's session later emits `agent_end`
- **THEN** the run SHALL NOT be finalized a second time and no duplicate run record SHALL be produced.

#### Scenario: Untrusted plugins cannot terminate sessions

- **WHEN** an untrusted plugin holds a `ServerPluginContext`
- **THEN** its run-termination capability SHALL be a no-op returning `false`, mirroring the `spawnSession` trust gate.

## ADDED Requirements

### Requirement: A completed run SHALL terminate its spawned session

Automation runs are spawned as persistent `--mode rpc` pi sessions that do not self-exit when a turn ends. When a run completes normally (its session emits `agent_end`) and the result has been captured, the run's spawned session SHALL be terminated so no idle pi process is left running. Termination on completion SHALL send a graceful clean-exit hint (session shutdown) AND SHALL always escalate to a hard process kill, unconditionally — not gated on whether the hint succeeds, because the hint is undeliverable when the bridge WebSocket is not open. This SHALL reuse the same host-provided, trust-gated termination capability used by user-initiated Stop.

#### Scenario: Completed run's session is ended

- **WHEN** a run's session emits `agent_end` and its result is captured
- **THEN** the run's spawned session SHALL be terminated
- **AND** no idle pi process for that run SHALL remain after finalization.

#### Scenario: Termination is idempotent with finalization

- **WHEN** terminating a completed run's session causes a further session-end signal
- **THEN** the run SHALL NOT be finalized a second time and no duplicate run record SHALL be produced.
