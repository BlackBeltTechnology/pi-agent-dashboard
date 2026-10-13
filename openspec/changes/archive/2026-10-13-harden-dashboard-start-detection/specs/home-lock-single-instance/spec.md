## MODIFIED Requirements

### Requirement: Canonical HOME resolution

The system SHALL provide a canonical, `$HOME`-immune home path (`canonicalHomedir()`) so that reasoning about `$HOME` drift between GUI-launched and shell-launched processes has a stable reference. The canonical path SHALL NOT locate the lock or its metadata sidecar; those follow the `$HOME`-honouring dashboard directory (see "Lock and metadata paths").

#### Scenario: Resolve HOME immune to $HOME override

- **WHEN** the canonical home directory is computed
- **THEN** the system SHALL use `os.userInfo().homedir` (which consults the OS password database) in preference to `os.homedir()`, so the POSIX `$HOME` environment variable does not shift the canonical path
- **AND** the resolved path SHALL be passed through `fs.realpathSync` to collapse symlinks and other canonicalization drift

#### Scenario: Fall back when resolution fails

- **WHEN** `os.userInfo()` throws
- **THEN** the system SHALL fall back to `os.homedir()`
- **AND** when `fs.realpathSync` throws, the system SHALL fall back to the raw path

### Requirement: Lock and metadata paths

The system SHALL derive the lock file and metadata sidecar paths from the `$HOME`-honouring dashboard directory (`<HOME>/.pi/dashboard`, the root shared with the gateway socket and `config.json`). Every reader of the lock or metadata SHALL derive the same path.

#### Scenario: Lock file path

- **WHEN** the lock path is derived
- **THEN** it SHALL be `<HOME>/.pi/dashboard/server.lock`, where `<HOME>` is the `$HOME`-honouring home of the process

#### Scenario: Metadata sidecar path

- **WHEN** the metadata path is derived from the lock path
- **THEN** it SHALL be `<lockPath>.meta.json`

#### Scenario: Metadata written atomically

- **WHEN** the lock is acquired and metadata is persisted
- **THEN** the system SHALL create the parent directory recursively
- **AND** SHALL write to a temp file then `rename` it into place so a partial metadata file is never visible
- **AND** the metadata SHALL record `pid`, `ppid`, `httpPort`, `piPort`, `startedAt`, a stable per-instance `identity`, `version`, `url`, and `hostname`
- **AND** when the server binds a specific non-loopback host, the metadata SHALL also record it as `bindHost` (an optional field; readers SHALL accept metadata without it)

### Requirement: Stale-lock reclaim

When the recorded lock holder is not a responsive matching dashboard, the system SHALL treat the lock as stale and reclaim it, but only when the holder is provably gone. Taking over a held lock SHALL happen only through this liveness verdict. The lock library's file-age staleness SHALL NOT, on its own, transfer a held lock to a new starter.

The holder's health SHALL be probed on both loopback addresses and, when the metadata records a `bindHost`, on that host too. A refusal counts only when every probed address refuses.

Taking over from a dead holder SHALL NOT depend on the lock library's in-process unlock or its file-age staleness. The system SHALL remove the holder's lock directory only if it is unchanged since the verdict (compare-and-remove on its modification time). It SHALL then acquire the lock, and replace the metadata only while holding the new lock. Metadata SHALL NOT be removed while the lock is not held.

The verdict for a holder whose recorded PID is alive:
- **answers with matching identity** within a bounded health retry budget → attach;
- **every attempt times out, or fails without a definitive refusal** (port held, silent) → **unresponsive**;
- **connection refused, `startedAt` younger than the start grace (30 s)** → **starting** (the holder records the lock before it binds its HTTP port);
- **connection refused, `startedAt` older than the start grace** → stale (the PID was recycled by an unrelated process).

For an unresponsive or starting holder, the system SHALL NOT reclaim the lock and SHALL NOT remove or overwrite its metadata. It SHALL signal a distinct unresponsive-holder error carrying the holder metadata and the reason (`timeout` | `starting`), so the caller can report it.

When a lock is taken over, the previous holder SHALL NOT crash when it notices the takeover. It SHALL log the takeover, disarm its own release (so that its later release or exit neither unlocks the successor's lock nor removes the successor's metadata), and stop acting as the HOME default.

#### Scenario: Reclaim when the holder PID is dead

- **WHEN** acquisition fails with `ELOCKED`, metadata is read, and the recorded PID is not alive
- **THEN** liveness SHALL be `dead`, and the system SHALL remove the stale lock, acquire it, and replace the stale metadata under the new lock to obtain a fresh `acquired` result
- **AND** it SHALL NOT wait for the lock library's stale window to elapse

#### Scenario: Reclaim when the holder is unreachable

- **WHEN** the recorded PID is alive, its metadata `startedAt` is older than the start grace, and connections to its `httpPort` are refused (e.g. the PID was recycled by an unrelated process)
- **THEN** liveness SHALL be `dead` and the lock SHALL be reclaimed as stale

#### Scenario: A holder still starting is not reclaimed

- **WHEN** the recorded PID is alive, its metadata `startedAt` is within the start grace, and connections to its `httpPort` are refused
- **THEN** the system SHALL NOT unlock the lock or touch the metadata
- **AND** it SHALL signal the unresponsive-holder error with reason `starting`

#### Scenario: A live holder that answers within the retry budget is not reclaimed

- **WHEN** the recorded PID is alive, the first health probe times out, and a later attempt within the retry budget answers with matching identity
- **THEN** the system SHALL return the attach result and SHALL NOT reclaim the lock

#### Scenario: An unresponsive live holder is never reclaimed

- **WHEN** the recorded PID is alive, its `httpPort` accepts connections, and every health probe within the retry budget times out (e.g. the holder is frozen with `SIGSTOP`)
- **THEN** the system SHALL NOT unlock the lock and SHALL NOT remove or overwrite the metadata sidecar
- **AND** it SHALL signal the unresponsive-holder error with reason `timeout` and the holder metadata
- **AND** after the call the metadata SHALL still record the holder's PID

#### Scenario: A frozen holder past the lock-file stale window is not taken over

- **WHEN** a holder is frozen (`SIGSTOP`) for longer than the lock library's stale window, so the lock file's age exceeds it
- **AND** a new starter attempts acquisition
- **THEN** the new starter SHALL NOT acquire the lock
- **AND** the metadata SHALL still record the frozen holder's PID

#### Scenario: A taken-over holder does not release its successor's lock

- **WHEN** holder A's lock is taken over by B (e.g. A was frozen in the missing-metadata window and later resumes)
- **AND** A later shuts down or calls its release
- **THEN** B's lock and B's metadata SHALL still exist
- **AND** A SHALL NOT have crashed on noticing the takeover

#### Scenario: Force-steal when metadata is missing after polling

- **WHEN** no readable metadata sidecar appears after the short-poll window
- **AND** the lock directory has not been refreshed within the lock library's stale window (10 s)
- **THEN** the system SHALL take the lock over with the same compare-and-remove, acquire and claim sequence as for a dead holder

#### Scenario: Missing metadata with a freshly refreshed lock is not stolen

- **WHEN** no readable metadata sidecar appears after the short-poll window
- **AND** the lock directory was refreshed within the stale window (a winner that has acquired but not yet written its record, e.g. on a stalled event loop)
- **THEN** the system SHALL NOT remove the lock
- **AND** it SHALL signal the unresponsive-holder error with reason `starting`

### Requirement: Lock release on signals and exit

The system SHALL release the lock on process termination through a separate release module that wires signal and exit handlers to a single idempotent release. A hold that has been compromised (taken over by a successor) SHALL make release a no-op for the lock directory and the metadata sidecar, both of which then belong to the successor.

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

#### Scenario: Compromised hold releases nothing

- **WHEN** the hold has been compromised and the process then receives a termination signal or exits
- **THEN** the release SHALL NOT remove the lock directory or the metadata sidecar
