# automation-run-lifecycle — delta

## ADDED Requirements

### Requirement: A running run can be stopped by the user

A user SHALL be able to stop a `running` automation run from the board. Stopping SHALL abort the run's spawned session via a host-provided `abortSession(sessionId)` capability exposed on `ServerPluginContext` (gated to trusted plugins like `spawnSession`) and SHALL finalize the run record. Finalization SHALL be idempotent with the normal `agent_end` capture path: a stopped run SHALL be finalized exactly once, and a subsequent end event for that session SHALL NOT re-finalize or duplicate the record.

#### Scenario: Stop aborts the run session and finalizes the record

- **WHEN** a user stops a `running` run
- **THEN** the run's session SHALL be sent an abort via `abortSession(sessionId)` AND the run record SHALL transition out of `running`.

#### Scenario: Stop is idempotent with agent_end

- **WHEN** a stopped run's session later emits `agent_end`
- **THEN** the run SHALL NOT be finalized a second time and no duplicate run record SHALL be produced.

#### Scenario: Untrusted plugins cannot abort sessions

- **WHEN** an untrusted plugin holds a `ServerPluginContext`
- **THEN** its `abortSession` SHALL be a no-op returning `false`, mirroring the `spawnSession` trust gate.

### Requirement: Run result records a findings count

When a run finishes, its record SHALL carry a `findings` count derived from `result.md`. The count SHALL be the number of findings captured (heuristic: top-level markdown bullet lines), and SHALL be `0` for a run that produced no assistant output and was auto-archived. The `/runs` route payload SHALL include `findings` so the client can show it without fetching `result.md`.

#### Scenario: Findings counted from result.md

- **WHEN** a run finishes with a `result.md` containing N top-level finding bullets
- **THEN** its run record SHALL report `findings: N`.

#### Scenario: Empty run reports zero findings

- **WHEN** a run produces no assistant output and is auto-archived
- **THEN** its run record SHALL report `findings: 0`.
