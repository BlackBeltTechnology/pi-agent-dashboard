## ADDED Requirements

### Requirement: Per-session stderr log path is recorded for diagnostic forwarding
The `spawnHeadlessDetached` function (Windows headless path) SHALL retain the per-session log path it opens (`~/.pi/dashboard/sessions/pi-spawn-<ts>-<rand>.log`) so that the immediate-crash branch can read its tail. The path SHALL be local to the function call (no global state) and SHALL be passed to a tail-reading helper before the function returns the failure result.

#### Scenario: log path retained across crash detection
- **WHEN** `spawnHeadlessDetached` opens the log file via `openSync` and `waitForNoCrash` subsequently reports `!ok`
- **THEN** the same `logPath` value SHALL be used to read the stderr tail attached to the returned `SpawnResult.stderr`

#### Scenario: log path retained for watchdog handoff
- **WHEN** `spawnHeadlessDetached` returns `success: true` with a `pid`
- **THEN** the `logPath` SHALL be available to callers (returned in `SpawnResult` as `logPath?: string`) so the spawn-register watchdog can read it on timeout

#### Scenario: log open fails
- **WHEN** `openSync` throws when creating the per-session log
- **THEN** the spawn SHALL still proceed and `SpawnResult.logPath` SHALL be `undefined`
