# home-lock-single-instance Specification

## Purpose

Ensure at most one dashboard server instance runs per HOME by acquiring a per-HOME advisory lock keyed by the canonicalized home directory. Acquisition is kept pure and separately testable; signal and exit release handlers live in a distinct release module. When a live matching dashboard already holds the lock, the caller attaches to it rather than starting a second instance; when the recorded holder is dead, the lock is reclaimed.

## Requirements

### Requirement: Canonical HOME resolution

The system SHALL resolve HOME to a canonical path so a GUI-launched process and a shell-launched process agree on "where HOME is."

#### Scenario: Resolve HOME immune to $HOME override

- **WHEN** the canonical home directory is computed
- **THEN** the system SHALL use `os.userInfo().homedir` (which consults the OS password database) in preference to `os.homedir()` so the POSIX `$HOME` environment variable does not shift the lock location
- **AND** the resolved path SHALL be passed through `fs.realpathSync` to collapse symlinks and other canonicalization drift

#### Scenario: Fall back when resolution fails

- **WHEN** `os.userInfo()` throws
- **THEN** the system SHALL fall back to `os.homedir()`
- **AND** when `fs.realpathSync` throws, the system SHALL fall back to the raw path

### Requirement: Lock and metadata paths

The system SHALL derive the lock file and metadata sidecar paths from the canonical HOME directory.

#### Scenario: Lock file path

- **WHEN** the lock path is derived
- **THEN** it SHALL be `<canonicalHome>/.pi/dashboard/server.lock`

#### Scenario: Metadata sidecar path

- **WHEN** the metadata path is derived from the lock path
- **THEN** it SHALL be `<lockPath>.meta.json`

#### Scenario: Metadata written atomically

- **WHEN** the lock is acquired and metadata is persisted
- **THEN** the system SHALL create the parent directory recursively
- **AND** SHALL write to a temp file then `rename` it into place so a partial metadata file is never visible
- **AND** the metadata SHALL record `pid`, `ppid`, `httpPort`, `piPort`, `startedAt`, a stable per-instance `identity`, `version`, `url`, and `hostname`

### Requirement: Lock acquisition

The system SHALL acquire a non-blocking, stale-aware advisory lock on the per-HOME lock file, returning an `acquired` result whose `release` removes both the lock and the metadata sidecar.

#### Scenario: Acquire a free lock

- **WHEN** no other instance holds the lock
- **THEN** the system SHALL ensure the lock file's parent directory exists and create an empty sentinel lock file if absent
- **AND** SHALL lock it via `proper-lockfile` with `retries: 0` and a stale threshold (default 10s)
- **AND** SHALL write the metadata sidecar and return `{ mode: "acquired", meta, release }`

#### Scenario: Release is idempotent

- **WHEN** the returned `release` is invoked more than once
- **THEN** only the first invocation SHALL unlock and remove the metadata sidecar
- **AND** subsequent invocations SHALL be no-ops
- **AND** an error thrown by the underlying unlock SHALL be swallowed

### Requirement: Already-locked-by-live-instance detection

When the lock is already held (`ELOCKED`), the system SHALL read the holder's metadata and probe its liveness before deciding to attach, error, or reclaim.

#### Scenario: Attach to a live matching dashboard

- **WHEN** acquisition fails with `ELOCKED`, metadata is read, the recorded PID is alive, and a health probe on `httpPort` reports running with an `identity` (or PID) that matches the metadata
- **THEN** the system SHALL return `{ mode: "attach", meta }` instead of starting a second instance

#### Scenario: Refuse when the port holder is unrelated

- **WHEN** acquisition fails with `ELOCKED`, the recorded PID is alive, and the health probe reports running but with a non-matching `identity`/PID (or no verifiable identity)
- **THEN** the system SHALL throw `InstanceLockMismatchError` (code `E_INSTANCE_MISMATCH`) carrying the holder metadata so the caller can exit with a message directing the user to a different port

#### Scenario: Metadata not yet written during a concurrent launch race

- **WHEN** acquisition fails with `ELOCKED` but no metadata sidecar is readable yet
- **THEN** the system SHALL short-poll for the metadata to appear (up to ~20 attempts spaced 25ms) before concluding the lock is stale

### Requirement: Stale-lock reclaim

When the recorded lock holder is not a responsive matching dashboard, the system SHALL treat the lock as stale and reclaim it.

#### Scenario: Reclaim when the holder PID is dead

- **WHEN** acquisition fails with `ELOCKED`, metadata is read, and the recorded PID is not alive
- **THEN** liveness SHALL be `dead`, and the system SHALL unlock the stale lock, remove the stale metadata, and retry acquisition to obtain a fresh `acquired` result

#### Scenario: Reclaim when the holder is unreachable

- **WHEN** the recorded PID is alive but the health probe on `httpPort` reports not running (or returns nothing)
- **THEN** liveness SHALL be `dead` and the lock SHALL be reclaimed as stale

#### Scenario: Force-steal when metadata is missing after polling

- **WHEN** no metadata sidecar appears after the short-poll window
- **THEN** the system SHALL remove any metadata and retry acquisition, unlocking once more and retrying a final time if it is still `ELOCKED`

### Requirement: Escape hatch

The system SHALL let the operator opt out of the per-HOME lock via environment variable.

#### Scenario: Opt out via environment

- **WHEN** `PI_DASHBOARD_ALLOW_MULTIPLE` is `"1"` or `"true"`
- **THEN** the lock SHALL be reported as disabled so the caller can skip acquisition and permit multiple instances

### Requirement: Lock release on signals and exit

The system SHALL release the lock on process termination through a separate release module that wires signal and exit handlers to a single idempotent release.

#### Scenario: Release on termination signals

- **WHEN** the process receives `SIGINT`, `SIGTERM`, `SIGHUP`, or `SIGBREAK`
- **THEN** the system SHALL invoke `release()` exactly once and then exit with code 0
- **AND** repeated signals SHALL NOT trigger a second release

#### Scenario: Best-effort release on exit

- **WHEN** the process emits `exit`
- **THEN** the system SHALL invoke `release()` best-effort (synchronous context, not awaited), swallowing any error

#### Scenario: Platform-tolerant signal registration

- **WHEN** handlers are installed on a platform lacking `SIGHUP`/`SIGBREAK` (e.g. Windows, where `taskkill /F` bypasses signals)
- **THEN** registration SHALL still succeed and unfired signals SHALL be harmless, with stale-lock detection reclaiming the lock on the next boot
- **AND** the installer SHALL return a function that removes all registered handlers
