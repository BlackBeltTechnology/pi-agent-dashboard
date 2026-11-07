# Spec Delta: automation-run-lifecycle

## MODIFIED Requirements

### Requirement: A running run can be stopped by the user

A user SHALL be able to stop a `running` automation run from the board. For a run the engine is tracking, stopping SHALL **terminate the run's spawned process** via a trusted host-provided capability on `ServerPluginContext` (gated to trusted plugins like `spawnSession`), and SHALL finalize the run record only after the termination has been attempted. Termination SHALL succeed regardless of run state, including the window after the run record is `running` but before its spawned session has registered: the host capability SHALL accept a `spawnToken` (captured at spawn time) so a not-yet-registered run can be killed by process handle, and SHALL accept a `sessionId` for a registered run. Finalization SHALL be idempotent with the normal `agent_end` capture path: a stopped run SHALL be finalized exactly once, and a subsequent end event for that session SHALL NOT re-finalize or duplicate the record.

A Stop request SHALL act only on a run that belongs to the scope the request was admitted for. This applies whether the request arrives through the REST route or through a plugin action. Stopping a run from another scope SHALL be rejected, and a folder-scope Stop without an admitted folder SHALL be rejected as a bad request. A `running` record that the engine is not tracking and that is not orphaned (it was started by the current server process) SHALL be rejected with a reason saying the stale-run reaper will finalize it.

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

#### Scenario: Folder Stop without a folder is a bad request

- **WHEN** a folder-scope Stop arrives without an admitted folder
- **THEN** it SHALL be rejected as a bad request and no process SHALL be signalled.

#### Scenario: Stop from another scope is rejected

- **WHEN** a Stop request admitted for one folder names a run that belongs to a different scope
- **THEN** the request SHALL be rejected and no process SHALL be signalled.

### Requirement: Parent and child runs are visible in the UI

The Automation view SHALL render a parent run as one entry that discloses its children. For each child it SHALL show the action label, status, a findings chip when the child's findings count is greater than 0, an Open session link when the child has a session id, and a Monitor link for a running or orphaned child. Board visibility SHALL be decided once per occurrence and applied to every child of that fire.

#### Scenario: Children listed under the parent

- **WHEN** a parent run with 3 children is viewed
- **THEN** the parent entry SHALL show aggregate status and be expandable to 3 child rows, each with its own action label, status, and session link

#### Scenario: Visibility applies to the whole occurrence

- **WHEN** the effective visibility for a fire is `hidden`
- **THEN** neither the parent nor any child SHALL appear on the board

## ADDED Requirements

### Requirement: An orphaned run is defined by engine context and server start

A run is **orphaned** when its persisted record is `running`, the engine holds no live context for it, and the run started before the current server process started (for example, the server restarted while it ran). A run started by the current server process SHALL NOT be orphaned, so the spawn-to-register window never takes the orphan path.

#### Scenario: Run in the spawn window is not orphaned

- **WHEN** a run started by the current server process has a `running` record but its context is not yet bound
- **THEN** it SHALL NOT be treated as orphaned.

### Requirement: Orphan Stop targets only the run's own stamped session

Orphan Stop SHALL terminate a process only when the record names a `sessionId` whose bridge connection is open, the session carries the dashboard's automation-run stamp for this run id and scope, and its real working directory is the admitted scope. The target SHALL NOT come from the request or from a workspace file alone, and termination SHALL use the trusted capability a live Stop uses.

#### Scenario: Stop on an orphaned run after a server restart

- **GIVEN** an orphaned run whose record has a `sessionId` and whose stamped session has reconnected
- **WHEN** a user stops the run
- **THEN** that session's process SHALL be terminated via the host capability.

#### Scenario: Forged record cannot target another session

- **GIVEN** an orphaned run record whose `sessionId` names a connected session that lacks this run's automation-run stamp
- **WHEN** a user stops the run
- **THEN** no process SHALL be signalled.

#### Scenario: Session from another scope is not signalled

- **GIVEN** an orphaned run record, admitted for one folder, whose `sessionId` names a connected session with the matching stamp but working in a different folder
- **WHEN** a user stops the run
- **THEN** no process SHALL be signalled.

#### Scenario: Orphan whose session is not connected

- **WHEN** an orphaned run's recorded session is not connected
- **THEN** no process SHALL be signalled.

### Requirement: Orphan Stop finalizes exactly once and stays visible

A stopped orphan SHALL be finalized `stopped` with a non-empty result noting it was stopped after losing track. It SHALL NOT be auto-archived as an empty run, and that finalization SHALL NOT prune it away under retention.

#### Scenario: Stopped orphan remains visible

- **WHEN** an orphaned run is stopped
- **THEN** its record SHALL be `stopped` with a non-empty result and SHALL NOT be auto-archived.

#### Scenario: Stop on a finished run is rejected

- **WHEN** a user stops a run whose record is `done`, `error` or `stopped`
- **THEN** the request SHALL be rejected and no process SHALL be signalled.

### Requirement: Stop reports an honest outcome

Every accepted Stop response SHALL carry one outcome (a rejected request signals nothing and carries an error instead):
- `killed` when the process is verified gone;
- `not-found` when no process is addressable (an orphaned record names no `sessionId`, or a parent has no non-terminal child left);
- `unconfirmed` in every other case.

This applies to live and orphaned runs alike. On `unconfirmed` the record reason SHALL say the process may still be running.

#### Scenario: Orphan session not connected or stamp mismatch

- **WHEN** an orphan Stop signals nothing because the session is not connected or lacks the run's stamp
- **THEN** the outcome SHALL be `unconfirmed`.

#### Scenario: Verified kill

- **WHEN** a stopped run's process is verified gone
- **THEN** the outcome SHALL be `killed`.

#### Scenario: Unverifiable termination is not reported as success

- **WHEN** termination cannot be verified, or the capability gives no detailed result
- **THEN** the outcome SHALL be `unconfirmed` and the record reason SHALL say the process may still be running.

#### Scenario: Orphan without a session id

- **WHEN** an orphaned run's record has no `sessionId`
- **THEN** the record SHALL be finalized `stopped` and the outcome SHALL be `not-found`.

### Requirement: Orphan Stop is exactly-once under concurrency

Concurrent Stop requests for the same orphaned run SHALL result in at most one termination attempt. The run SHALL be finalized exactly once, even if Stop races another Stop or the stale-run reaper. A Stop that loses the race SHALL report that the run was already finalized.

#### Scenario: Concurrent Stops signal once

- **WHEN** two Stop requests for the same orphaned run arrive together
- **THEN** at most one termination SHALL be attempted and both responses SHALL report the same finalization.

#### Scenario: Stop races the reaper

- **WHEN** an orphaned run is stopped while the stale-run reaper finalizes it
- **THEN** the run record SHALL be finalized exactly once.

### Requirement: Orphan Stop covers the whole occurrence

Stopping an orphaned parent SHALL stop every child: tracked children via the live Stop, orphaned children via the orphan path. The parent SHALL be finalized once all children are terminal. Stopping an orphaned child SHALL also finalize its parent when that child was the last non-terminal one. A parent's outcome SHALL be `killed` only when every stopped child was killed, and `not-found` only when every child was `not-found`; otherwise it SHALL be `unconfirmed`.

#### Scenario: Last orphaned child finalizes its parent

- **WHEN** the last non-terminal child of an orphaned parent is stopped
- **THEN** the parent SHALL be finalized with its combined status and summed findings.

#### Scenario: Mixed child outcomes make the parent unconfirmed

- **WHEN** an orphaned parent is stopped and one child is killed while another is unconfirmed
- **THEN** the parent's outcome SHALL be `unconfirmed`.

### Requirement: The runs listing marks orphaned runs and session connectivity

The runs listing SHALL mark each run (and each child of a parent) `orphaned` when it meets the orphaned definition above, and SHALL report whether the engine is tracking it. For each run with a `sessionId`, it SHALL report whether that session is currently connected. It SHALL tag each run with the scope it was listed from. These fields SHALL be computed when the listing is produced and SHALL NOT be written to the run record.

#### Scenario: Run started before a restart is orphaned

- **GIVEN** a run record `running` that was started by a previous server process
- **WHEN** the runs listing is requested after the restart
- **THEN** that run SHALL be marked `orphaned`.

#### Scenario: Live tracked run is not orphaned

- **WHEN** the runs listing includes a run the engine is currently tracking, or a run started by the current server process
- **THEN** that run SHALL NOT be marked `orphaned`.

#### Scenario: Connectivity reported

- **WHEN** an orphaned run's session has reconnected
- **THEN** the listing SHALL report that session as connected.
