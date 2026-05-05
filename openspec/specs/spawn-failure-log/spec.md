# spawn-failure-log

## Purpose

Append-only NDJSON log capturing every failed pi-session spawn (preflight refusal, spawnPiSession failure, thrown exception, register timeout) at `~/.pi/dashboard/sessions/spawn-failures.log`, with single-step rotation at 10 MB. Read API powers `GET /api/spawn-failures` and future diagnostic surfaces.

## Requirements

### Requirement: Append-only NDJSON failure log with single rotation
The module `packages/server/src/spawn-failure-log.ts` SHALL export `appendSpawnFailure(entry: SpawnFailureEntry): void` and `readSpawnFailures(limit: number): SpawnFailureEntry[]`. The on-disk file SHALL live at `~/.pi/dashboard/sessions/spawn-failures.log` (co-located with per-session `pi-spawn-*.log` captures). The directory SHALL be created with `mkdirSync({ recursive: true })` if missing. Each entry SHALL be one JSON object per line, terminated by `\n`. When `appendSpawnFailure` observes the file size to be greater than 10485760 bytes (10 MB) before its write, the existing `sessions/spawn-failures.log` SHALL be renamed to `sessions/spawn-failures.log.1` (overwriting any prior `.log.1`), and the new entry SHALL be written to a fresh `.log`. There SHALL be no `.log.2` or higher.

`SpawnFailureEntry` SHALL contain: `ts: string` (ISO 8601 UTC), `cwd: string`, `strategy: string`, `code: string`, `message: string`, and optional `stderrTail?: string`, `pid?: number`, `reasons?: PreflightReason[]`.

#### Scenario: append below threshold
- **WHEN** `appendSpawnFailure(entry)` is called and the existing log is under 10 MB
- **THEN** the entry SHALL be appended as a single `\n`-terminated JSON line to `sessions/spawn-failures.log`
- **AND** `.log.1` SHALL NOT be touched

#### Scenario: append triggers rotation
- **WHEN** `appendSpawnFailure(entry)` is called and the existing log size exceeds 10485760 bytes
- **THEN** the current `sessions/spawn-failures.log` SHALL be renamed to `sessions/spawn-failures.log.1` (overwriting if exists)
- **AND** the new entry SHALL be the first line of a fresh `sessions/spawn-failures.log`

#### Scenario: append with disk error
- **WHEN** `appendSpawnFailure(entry)` is called and the underlying write throws
- **THEN** the error SHALL be caught and logged via `console.error` only
- **AND** the caller SHALL NOT observe a thrown exception

#### Scenario: read returns last N entries newest-last
- **WHEN** `readSpawnFailures(50)` is called and the log contains 200 valid entries
- **THEN** the function SHALL return an array of length 50 containing entries 151..200 in file order

#### Scenario: read skips malformed lines
- **WHEN** `readSpawnFailures(N)` encounters a line that is not valid JSON or is missing required fields
- **THEN** that line SHALL be skipped and parsing SHALL continue with the next line

#### Scenario: read with no log file
- **WHEN** `readSpawnFailures(N)` is called and no `sessions/spawn-failures.log` exists
- **THEN** the function SHALL return `[]` without throwing

#### Scenario: limit clamped to non-negative
- **WHEN** `readSpawnFailures(0)` or `readSpawnFailures(-5)` is called
- **THEN** the function SHALL return `[]`

### Requirement: Handler appends every failure to the rolling log
`session-action-handler.handleSpawnSession` SHALL call `appendSpawnFailure` for every failure path it emits a `spawn_error` for: preflight refusal, `spawn_result.success === false`, thrown exception from `spawnPiSession`, and `spawn_register_timeout` from the watchdog.

#### Scenario: preflight failure persisted
- **WHEN** preflight refuses a spawn
- **THEN** an entry with `code: "PREFLIGHT_FAILED"` and the `reasons` array SHALL be appended

#### Scenario: spawnPiSession failure persisted
- **WHEN** `spawnPiSession` returns `success: false`
- **THEN** an entry with `code: result.code`, `message: result.message`, and `stderrTail: result.stderr` (if present) SHALL be appended

#### Scenario: thrown exception persisted
- **WHEN** `spawnPiSession` throws
- **THEN** an entry with `code: "SPAWN_ERRNO"` and `message` from the error SHALL be appended

#### Scenario: register timeout persisted
- **WHEN** the spawn-register watchdog fires for a PID
- **THEN** an entry with `code: "REGISTER_TIMEOUT"` and the captured `stderrTail` (if any) SHALL be appended
