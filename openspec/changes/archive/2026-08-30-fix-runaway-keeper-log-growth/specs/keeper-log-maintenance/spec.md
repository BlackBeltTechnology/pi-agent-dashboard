## ADDED Requirements

### Requirement: Startup sweep SHALL reclaim oversized keeper logs by truncation, never by unlinking

`KeeperManager` SHALL run a bounded keeper-log sweep of its `sessionsDir` once per server start. The sweep SHALL enumerate matching files with a single directory read plus one `stat` per match, and SHALL NOT recurse, read log-file contents, or run on a repeating schedule.

The sweep SHALL reclaim a file by truncating it to zero length (`fs.truncateSync(path, 0)`). It SHALL NOT unlink, rename, or reopen any keeper log under any condition.

This is a safety property, not a stylistic choice. No liveness predicate available to the server can prove that no process holds a given log open: `discoverExistingKeepers()` unlinks the keeper PID, socket, and pi-PID sidecars unconditionally after SIGTERM without verifying the kill took, so a wedged keeper survives with every sidecar naming it already gone; and with capture enabled the pi child holds a dup of the same descriptor, so a SIGKILLed keeper can leave a reparented pi writing. Unlinking a log with a live writer produces an inode that keeps growing while being invisible to `readdir`, to every size check, and to the health statistics — strictly worse than the unbounded growth being fixed. Truncation reclaims the same bytes, detaches no writer, and leaves the file reachable by path so a later sweep and every stats refresh can still observe it.

File enumeration SHALL go through a single shared `listKeeperLogs()` helper used by both the sweep and the `/api/health` stats refresh, so the naming rule, the exclusion, the cap, and the test-home gate cannot drift between the set that is measured and the set that is acted on. It SHALL match `keeper-<sessionId>.log` only, and SHALL exclude `keeper-launch-*.log` (bootstrap stderr written by `KeeperManager`), which a naive `keeper-(.+)\.log` pattern would misread as a session named `launch-<id>`.

The sweep SHALL truncate a file only when **all** of the following hold:
1. no live keeper process for the session — the keeper PID sidecar is absent, unparseable, or names a dead process;
2. the file size is at or above `keeperLog.maxBytes`; and
3. the file `mtime` is older than `KEEPER_LOG_SWEEP_MIN_AGE_MS` (5 minutes).

These conditions exist to avoid destroying a log someone is still reading, not to make truncation safe — truncation is safe regardless. Being wrong about any of them costs log content, not correctness.

The sweep SHALL be skipped entirely when `isUnsafeTestHomeScan()` reports an unsafe scan, exactly as `cleanupKeeperOrphans` is gated — vitest runs with a real `HOME`, and an ungated boot-time sweep would destroy the contents of real files in a developer's `~/.pi/dashboard/sessions`.

The sweep SHALL be best-effort: a stat or truncate failure on one file SHALL be logged and skipped, and SHALL NOT abort the sweep or fail server startup.

#### Scenario: Oversized, old log of a dead session is reclaimed by truncation
- **WHEN** the sweep finds `keeper-<sessionId>.log` at or above the cap, older than the minimum age, with no live keeper process for `<sessionId>`
- **THEN** the file SHALL still exist after the sweep
- **AND** its size SHALL be zero
- **AND** the sweep SHALL report the reclaimed byte count

#### Scenario: No keeper log is ever unlinked by the sweep
- **WHEN** the sweep runs over any combination of live, dead, oversized, small, old, and fresh keeper logs
- **THEN** every file present before the sweep SHALL still be present after it

#### Scenario: A live session's log is left untouched
- **WHEN** the sweep finds an oversized log and a live keeper process owns `<sessionId>`
- **THEN** the file SHALL still exist after the sweep with its size unchanged
- **AND** the sweep SHALL count it as observed-but-skipped rather than reclaimed

#### Scenario: A freshly opened log with no PID sidecar yet survives the sweep
- **WHEN** the sweep finds an oversized log whose `mtime` is within `KEEPER_LOG_SWEEP_MIN_AGE_MS` and for which no PID sidecar exists yet
- **THEN** the file SHALL NOT be truncated
- **AND** the sweep SHALL complete normally

#### Scenario: Small dead logs are retained intact
- **WHEN** the sweep finds a `keeper-<sessionId>.log` below the cap whose session is dead
- **THEN** the file SHALL be left with its contents intact

#### Scenario: Launch logs are not swept
- **WHEN** `keeper-launch-<sessionId>.log` is present in `sessionsDir` at any size
- **THEN** the sweep SHALL NOT truncate or unlink it

#### Scenario: Sweep does not run under an unsafe test home
- **WHEN** `isUnsafeTestHomeScan()` returns true at server start
- **THEN** the sweep SHALL perform no directory read and no truncation
- **AND** server startup SHALL proceed normally

#### Scenario: Truncate failure does not fail startup
- **WHEN** truncating a reclaimable file throws (permission denied, sharing violation)
- **THEN** the sweep SHALL skip that file, continue with the remaining files, and complete
- **AND** server startup SHALL proceed normally

### Requirement: Keeper-log footprint SHALL be observable via /api/health

`/api/health` SHALL expose a `keeperLogs` block so keeper-log growth is legible to the system rather than discovered by hand. The block SHALL report `totalBytes` across all keeper logs in `sessionsDir`, `fileCount`, `largestBytes`, `reclaimedBytes` (total reclaimed by the most recent startup sweep), `runawayFiles` (count of keeper logs at or above **twice** `keeperLog.maxBytes`), and `launchLogFiles` / `launchLogBytes` for the excluded `keeper-launch-*.log` family.

`runawayFiles` is the observable for **rotation not working**. The keeper runs in a separate process and cannot report a failed truncation to the server; its diagnostic line lands in a file nobody reads. A non-zero `runawayFiles` on a running system — the Windows truncation-refused case, a permission failure, a pre-upgrade keeper — is the only signal that the bound is not holding.

The threshold SHALL be `2 × maxBytes`, NOT `maxBytes`, because the bound is steady-state: a healthy log crosses the cap on every refill and is truncated at the next check, so a `≥ maxBytes` counter would fire routinely on correctly rotating keepers and reduce the one silent-failure observable to noise. The threshold is a **heuristic, not a proof** — a healthy keeper can exceed it when a single check interval carries more than one full cap of output, and a keeper spawned before a `maxBytes` reduction bounds at its own spawn-time cap. `largestBytes` is the unfiltered figure for anyone who needs one.

`launchLogFiles` / `launchLogBytes` are reported because `keeper-launch-*.log` is opened once per spawn with a fresh transport id, append-only, and is never truncated or unlinked by anything — an unbounded accumulation channel of the same family as the defect being fixed. Bounding it is out of scope; making it visible is not.

The stats scan SHALL use the same `listKeeperLogs()` helper as the sweep. The reported figures SHALL come from a cached snapshot, seeded by the startup sweep and refreshed lazily at most once per `KEEPER_LOG_STATS_TTL_MS` (60 s). `/api/health` SHALL NOT perform an unconditional filesystem scan per request; the route is unauthenticated and polled.

`reclaimedBytes` SHALL be owned by the sweep and SHALL survive stats refreshes — reclaimed bytes are no longer on disk, so a refresh that recomputed the field from the filesystem would zero it and destroy the evidence that the sweep ran.

The zero/degraded value SHALL be an explicitly typed constant (the `EMPTY_TRIM_STATS` convention already used for `storeTrim`), not an inline object literal, so a later added field cannot be silently omitted while still typechecking.

#### Scenario: Health reports the keeper-log footprint
- **WHEN** `GET /api/health` is served
- **THEN** the response SHALL include `keeperLogs` with numeric `totalBytes`, `fileCount`, `largestBytes`, `reclaimedBytes`, `runawayFiles`, `launchLogFiles`, and `launchLogBytes`

#### Scenario: An unrotatable log is visible as runaway
- **WHEN** a keeper log is at or above twice the cap at stats-refresh time
- **THEN** `runawayFiles` SHALL be at least 1
- **AND** `largestBytes` SHALL be at or above twice the cap

#### Scenario: A healthy log momentarily over the cap is not reported as runaway
- **WHEN** a keeper log is at or above `maxBytes` but below `2 × maxBytes` at stats-refresh time
- **THEN** `runawayFiles` SHALL NOT count it

#### Scenario: Reclaimed bytes survive a stats refresh
- **WHEN** the startup sweep reports a non-zero reclaimed total and a later lazy refresh rescans the directory
- **THEN** `reclaimedBytes` SHALL still report the swept total

#### Scenario: Repeated health polls do not rescan the directory
- **WHEN** `/api/health` is requested repeatedly within `KEEPER_LOG_STATS_TTL_MS`
- **THEN** at most one keeper-log directory scan SHALL occur across those requests

#### Scenario: A missing or unreadable sessions directory degrades to zeros
- **WHEN** `sessionsDir` does not exist or cannot be read
- **THEN** `keeperLogs` SHALL report the typed zero constant
- **AND** `/api/health` SHALL still return successfully

### Requirement: Sweep and stats thresholds SHALL arrive through KeeperManagerOptions

`createKeeperManager` SHALL accept `maxBytes`, `sweepMinAgeMs`, and `statsTtlMs` as optional options with the documented defaults, and SHALL NOT import the shared config directly. The composition root SHALL pass the `config.keeperLog` values in. `KeeperManager` has no config dependency today; preserving that keeps its tests cheap and keeps the thresholds injectable.

#### Scenario: Options drive the sweep threshold
- **WHEN** `createKeeperManager({ maxBytes })` is constructed with a small cap
- **THEN** the sweep SHALL reclaim files at or above that cap
- **AND** SHALL leave files below it intact

#### Scenario: Defaults apply when options are omitted
- **WHEN** `createKeeperManager()` is constructed with no threshold options
- **THEN** the sweep SHALL use 128 MiB, a 5-minute minimum age, and a 60-second stats TTL
