## MODIFIED Requirements

### Requirement: Crash detection for keeper spawn
The 300ms `waitForNoCrash` window applied to direct pi spawns SHALL be applied to KEEPER spawns instead of pi spawns when the keeper path is used. If the keeper process crashes within 300ms of spawn (e.g. UDS bind failure, Node module-resolution error), `spawnPiSession` SHALL return `SpawnResult {success: false, code: "PI_CRASHED"}` whose message includes the keeper exit code. The result SHALL NOT carry a `stderr` tail for keeper spawns, because the keeper's startup output goes to `keeper-launch-<id>.log` (capture on) or is discarded (capture off). With capture on, the message SHALL name the log files. With capture off, the message SHALL tell the user to enable "Capture pi session output (debug)" and start a new session (see `rpc-keeper-sidecar` Requirement "Keeper failure modes").

The keeper itself SHALL apply its own crash-detection window to the pi child (300ms) and exit non-zero if pi crashes during the window, logging the cause when capture is enabled. This propagates to the dashboard server via the keeper's exit status, which the server detects via the spawn-register watchdog (existing).

#### Scenario: Keeper crashes immediately on spawn
- **WHEN** `spawnPiSession(cwd, {strategy: "headless"})` is called AND the keeper crashes within 300ms AND keeper log capture is enabled
- **THEN** `result.success` SHALL be `false`
- **AND** `result.code` SHALL be `"PI_CRASHED"` (re-using existing error code; the user-facing error message MAY clarify "keeper crashed")
- **AND** the message SHALL include the keeper exit code and name `keeper-<id>.log` and `keeper-launch-<id>.log`

#### Scenario: Keeper crashes immediately with capture disabled
- **WHEN** the keeper crashes within 300ms AND keeper log capture is disabled
- **THEN** `result.success` SHALL be `false` and `result.code` SHALL be `"PI_CRASHED"`
- **AND** the message SHALL include the keeper exit code and the instruction to enable "Capture pi session output (debug)"
- **AND** `result.stderr` SHALL be absent

#### Scenario: Pi crashes inside the keeper
- **WHEN** the keeper spawns pi successfully but pi crashes within 300ms
- **THEN** the keeper SHALL exit non-zero
- **AND** the dashboard server's spawn-register watchdog SHALL detect the keeper's exit before the bridge registers
- **AND** the user SHALL see a `spawn_failed` event, with details from the keeper's log file when capture is enabled
