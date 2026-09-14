## Purpose

Automatically moves stale ended sessions into the archive on a configurable age threshold and interval, so a long-lived dashboard does not accumulate thousands of resident ended sessions.

## ADDED Requirements

### Requirement: Configurable archive threshold and interval

The dashboard config SHALL expose `sessionList.archiveAfterDays` (integer ≥ 0, default `30`) and `sessionList.archiveSweepIntervalMinutes` (integer ≥ 1, default `60`). A value of `0` for `archiveAfterDays` SHALL disable automatic archiving. Both values SHALL be readable and writable through the existing config endpoints and SHALL take effect on the next sweep without a server restart.

#### Scenario: Defaults when absent
- **WHEN** the config file has no `sessionList` section
- **THEN** the effective values SHALL be `archiveAfterDays = 30` and `archiveSweepIntervalMinutes = 60`

#### Scenario: Zero disables auto-archive
- **WHEN** `archiveAfterDays` is `0`
- **THEN** the sweeper SHALL archive nothing, regardless of session age

#### Scenario: Config change applies live
- **WHEN** `archiveAfterDays` is changed from 30 to 7 via the config write endpoint
- **THEN** the next sweep SHALL use 7 days without a restart

### Requirement: Sweep archives ended sessions older than the threshold

On every sweep the server SHALL archive each resident session that is `ended`, has `live !== true`, is not currently viewed by any connected browser, and whose reference time `max(endedAt, restoredAt)` is older than `archiveAfterDays` days (`endedAt` having been derived at boot when the sidecar lacked it). Each archived session SHALL follow the same transition as a manual archive (sidecar write, removal from the live set, `session_archived` broadcast). A single tick SHALL archive at most 200 sessions, oldest first; the remainder waits for later ticks. The sweep SHALL run every `archiveSweepIntervalMinutes` starting after boot discovery completes.

#### Scenario: Old ended session is archived
- **WHEN** a sweep runs with `archiveAfterDays = 30` and a resident ended session has `endedAt` 45 days ago and no `restoredAt`
- **THEN** the session SHALL be archived and `session_archived` broadcast

#### Scenario: Recent ended session is kept
- **WHEN** a sweep runs and a resident ended session has `endedAt` 10 days ago
- **THEN** the session SHALL remain resident

#### Scenario: Restore restarts the clock
- **WHEN** a session with `endedAt` 60 days ago was restored 5 days ago (`restoredAt`) and a sweep runs with `archiveAfterDays = 30`
- **THEN** the session SHALL remain resident
- **AND WHEN** 26 more days pass and a sweep runs
- **THEN** the session SHALL be archived again

#### Scenario: Alive sessions are never swept
- **WHEN** a sweep runs and a session is alive (running or idle)
- **THEN** it SHALL NOT be archived

#### Scenario: Per-tick cap
- **WHEN** `archiveAfterDays` is lowered so 1000 resident sessions become eligible
- **THEN** the next tick SHALL archive the 200 oldest and later ticks SHALL archive the rest

#### Scenario: Currently viewed session is deferred
- **WHEN** a sweep runs and an eligible ended session is currently open in a connected browser
- **THEN** it SHALL NOT be archived on that tick and SHALL be archived on a later tick once no longer viewed

#### Scenario: Interrupted session is never swept
- **WHEN** a sweep runs and a resident ended session has `live === true` (cold-start recovery candidate)
- **THEN** it SHALL NOT be archived

### Requirement: Boot scan archives aged-out sessions without eviction

During the boot meta scan, a session with `live !== true` (not a recovery candidate — persisted status MAY still be non-`ended` after a clean server stop) and no `archived` field whose `max(endedAt ?? sidecar mtime, restoredAt)` is older than `archiveAfterDays` days (threshold > 0) SHALL be archived at scan time: sidecar rewritten with `archived: true, archivedAt`, added to the archive index, never restored into the live set, and no `session_removed` broadcast SHALL be emitted for it.

#### Scenario: Aged-out sessions are archived at scan
- **WHEN** the server boots with `archiveAfterDays = 30` and 3000 sidecars are ended 45 days ago
- **THEN** the first `sessions_snapshot` SHALL contain none of them, their group paths SHALL carry the counts, and no `session_archived` SHALL have been broadcast

#### Scenario: Clean-stop sidecar with stale non-ended status is aged out
- **WHEN** the server boots and a sidecar has `status: "idle"`, `live: false`, and mtime 45 days ago
- **THEN** it SHALL be archived at scan time and not restored

#### Scenario: Zero threshold archives nothing at scan
- **WHEN** the server boots with `archiveAfterDays = 0`
- **THEN** no sidecar SHALL be rewritten by the age rule

### Requirement: Sweep is observable

Each sweep SHALL emit one log line reporting the number of sessions archived and the elapsed time, and SHALL skip logging when nothing was archived at debug level or below.

#### Scenario: Sweep log line
- **WHEN** a sweep archives 12 sessions in 40 ms
- **THEN** the server log SHALL contain a single line stating 12 archived and the duration
