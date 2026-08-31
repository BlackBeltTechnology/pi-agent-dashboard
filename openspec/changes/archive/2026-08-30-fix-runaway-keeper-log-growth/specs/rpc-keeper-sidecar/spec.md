## ADDED Requirements

### Requirement: Keeper log SHALL be size-bounded by in-place truncation

The keeper SHALL bound the growth of `keeper-<sessionId>.log`. When the log reaches `keeperLog.maxBytes` (default 128 MiB), the keeper SHALL truncate it in place to zero length and SHALL retain no rotated generation.

Truncation SHALL be attempted on the descriptor first (`fs.ftruncateSync(logFd, 0)`) and, if that throws, by path (`fs.truncateSync(logPath, 0)`) as a fallback. The descriptor is opened `O_APPEND` and Windows may refuse a descriptor truncation on such a handle; the fallback opens its own handle against the same inode. Before falling back, the keeper SHALL confirm that `logPath` still resolves to the same inode as `logFd`, so a swapped or replaced path cannot be truncated in place of the file actually being measured.

Rotation SHALL NOT rename, unlink, reopen, or copy the live log while the keeper is running. The descriptor `logFd` is handed to the pi child as `stdio: ["pipe", logFd, logFd]` when `PI_KEEPER_CAPTURE_PI_OUTPUT` is `"1"`; renaming or reopening leaves the child writing into the detached inode, so growth would continue invisibly. Copying the file before truncation is likewise excluded: it blocks the keeper's event loop for hundreds of milliseconds against a 350 ms RPC attempt timeout, and it fails permanently on a full disk. Truncating in place preserves the inode and the shared `O_APPEND` open file description, so both the keeper and the pi child continue writing into the bounded file.

The bound is **steady-state, not instantaneous**: size is sampled on a cadence, so a burst writer MAY exceed the cap by up to one check interval of output before the next check truncates. Per-session steady-state disk usage SHALL be one cap, not a multiple.

The keeper SHALL check the log size on two triggers, because either writer alone can drive growth:
1. from its own `log()` writer, throttled to at most one size check per `keeperLog.checkIntervalMs` (default 5 s) so the hot path stays cheap; and
2. from a periodic timer on the same interval, `unref()`'d so it never keeps the keeper alive — required because with capture enabled the growth comes from the pi child, which the keeper's own writer never observes.

The size check SHALL use `fs.fstatSync(logFd)`, not a path stat, so it observes the object the writes go to even if the path is unlinked or replaced underneath.

Truncation SHALL NOT reset any writer's file offset, and correctness after truncation therefore depends on every writer holding `O_APPEND`. The keeper SHALL keep opening the log with mode `"a"` and SHALL NOT perform positioned writes to it; a positioned write after a truncation would recreate a sparse multi-gigabyte file.

Rotation SHALL be best-effort and SHALL NOT alter keeper lifecycle. Both trigger call sites SHALL contain their own `try/catch`: the keeper installs an `uncaughtException` handler that shuts the session down, so an unguarded throw from the timer callback would end the session over a logging concern. Any failure SHALL degrade to a single diagnostic line and a skipped rotation, and SHALL NOT crash the keeper, abort pi, or block the RPC forward path.

#### Scenario: Log truncates when it exceeds the cap
- **WHEN** `keeper-<sessionId>.log` reaches or exceeds `keeperLog.maxBytes` and a size check fires
- **THEN** the keeper SHALL truncate `keeper-<sessionId>.log` to zero length
- **AND** subsequent keeper log lines SHALL appear in the truncated file

#### Scenario: Inode is preserved so the pi child keeps writing into the bounded file
- **WHEN** rotation occurs while the pi child holds the log descriptor as its stdout/stderr
- **THEN** the inode of `keeper-<sessionId>.log` SHALL be unchanged across the rotation
- **AND** output written by the pi child after rotation SHALL appear in `keeper-<sessionId>.log`
- **AND** the size of `keeper-<sessionId>.log` after rotation SHALL be less than `keeperLog.maxBytes`

#### Scenario: No rotated generation is produced
- **WHEN** the log rotates any number of times
- **THEN** no `keeper-<sessionId>.log.1` or other generation file SHALL exist
- **AND** no copy of the log SHALL be made at rotation time

#### Scenario: Growth driven only by the pi child still triggers rotation
- **WHEN** `PI_KEEPER_CAPTURE_PI_OUTPUT` is `"1"` and the pi child writes past the cap while the keeper itself emits no log lines
- **THEN** the periodic size check SHALL detect the excess
- **AND** the log SHALL be truncated without any keeper-originated write

#### Scenario: Descriptor truncation refused falls back to path truncation
- **WHEN** `fs.ftruncateSync(logFd, 0)` throws (e.g. a Win32 `O_APPEND` handle without `FILE_WRITE_DATA`)
- **THEN** the keeper SHALL attempt `fs.truncateSync(logPath, 0)`
- **AND** the log SHALL end up below the cap when the fallback succeeds

#### Scenario: Fallback refuses a path that no longer names the measured file
- **WHEN** descriptor truncation throws and `logPath` resolves to a different inode than `logFd`
- **THEN** the keeper SHALL NOT truncate that path
- **AND** the rotation SHALL be skipped as a failure

#### Scenario: Rotation failure never crashes the keeper or ends the session
- **WHEN** both truncation attempts throw, on either trigger path including the interval timer
- **THEN** the keeper SHALL continue running and SHALL keep forwarding RPC lines to pi
- **AND** the keeper SHALL NOT invoke its shutdown path
- **AND** the keeper SHALL NOT retry more often than the normal check interval

### Requirement: Keeper log bounds SHALL be configured, not hardcoded twice

`config.keeperLog` SHALL carry `maxBytes` (default `134217728`) and `checkIntervalMs` (default `5000`). `parseKeeperLogConfig` SHALL parse and validate both keys — it currently returns only `capturePiOutput` and drops unknown keys, which would silently discard an operator's setting while `config.json` still displays it.

The server SHALL pass them to the keeper at spawn time as the env vars `PI_KEEPER_LOG_MAX_BYTES` and `PI_KEEPER_LOG_CHECK_INTERVAL_MS`, following the existing `PI_KEEPER_CAPTURE_PI_OUTPUT` plumbing, and SHALL use the same config values for the sweep and stats thresholds. `keeper.cjs` SHALL read them from the environment and fall back to the same defaults when unset or unparseable, and SHALL remain CJS-pure — no import of the shared config.

The keeper SHALL delete both variables from the environment it passes to the pi child, as it already does for `PI_KEEPER_CAPTURE_PI_OUTPUT` and as `keeper-env.cjs` does for `PI_KEEPER_PI_ARGS` / `PI_KEEPER_PI_CMD`. Keeper-internal tuning SHALL NOT leak into pi's observable environment.

#### Scenario: Config drives the keeper's cap
- **WHEN** `config.keeperLog.maxBytes` is set and a keeper is spawned
- **THEN** the keeper process env SHALL carry `PI_KEEPER_LOG_MAX_BYTES` with that value
- **AND** the keeper SHALL rotate at that threshold rather than the default

#### Scenario: Config values survive parsing
- **WHEN** `config.json` sets `keeperLog.maxBytes` and `keeperLog.checkIntervalMs` to valid positive numbers
- **THEN** `loadConfig().keeperLog` SHALL report those values, not the defaults
- **AND** an absent, non-numeric, or non-positive value SHALL fall back to the default for that key

#### Scenario: Absent or invalid env falls back to the defaults
- **WHEN** `PI_KEEPER_LOG_MAX_BYTES` or `PI_KEEPER_LOG_CHECK_INTERVAL_MS` is unset, empty, non-numeric, or non-positive
- **THEN** the keeper SHALL use 128 MiB / 5000 ms respectively
- **AND** the keeper SHALL start normally

#### Scenario: Keeper-internal log vars do not reach pi
- **WHEN** the keeper spawns its pi child with either log env var set in its own environment
- **THEN** the child environment SHALL NOT contain `PI_KEEPER_LOG_MAX_BYTES` or `PI_KEEPER_LOG_CHECK_INTERVAL_MS`
