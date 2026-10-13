## MODIFIED Requirements

### Requirement: Per-HOME advisory lock
The dashboard server SHALL acquire a per-HOME advisory lock at `<HOME>/.pi/dashboard/server.lock` (the `$HOME`-honouring dashboard directory) via `proper-lockfile`. Only one dashboard instance per HOME MAY hold the lock at a time. A held lock SHALL change hands only through the liveness verdict of `home-lock-single-instance` "Stale-lock reclaim", never through the lock file's age alone.

#### Scenario: Fresh acquire
- **WHEN** no prior dashboard has run for this HOME
- **AND** `pi-dashboard` starts
- **THEN** the lock is acquired successfully
- **AND** a metadata sidecar `server.lock.meta.json` is written with `{ pid, ppid, httpPort, piPort, startedAt, identity, version, url, hostname }`

#### Scenario: Lock held by alive instance
- **WHEN** another dashboard instance is running and holds the lock
- **AND** a new `pi-dashboard` starts
- **THEN** the new instance reads the metadata sidecar
- **AND** verifies that the recorded PID is alive and that `/api/health` on `httpPort` answers with matching identity within the bounded retry budget of `home-lock-single-instance` "Stale-lock reclaim"
- **AND** enters attach mode: it does not write the record or claim the HOME default

#### Scenario: Stale lock (process dead)
- **WHEN** the lock file exists but the recorded PID is dead
- **THEN** the liveness verdict reports the holder as dead
- **AND** the new instance steals the lock
- **AND** replaces the stale metadata sidecar

#### Scenario: Identity mismatch
- **WHEN** the lock is held and the PID is alive
- **AND** `isDashboardRunning(httpPort)` succeeds but `/api/health` returns a different identity than the metadata sidecar
- **THEN** acquisition SHALL fail with `InstanceLockMismatchError` (`E_INSTANCE_MISMATCH`) carrying the holder metadata

#### Scenario: Unresponsive holder keeps the lock
- **WHEN** the lock is held, the PID is alive, and the holder does not answer `/api/health` within the retry budget
- **THEN** acquisition SHALL fail with the unresponsive-holder error, and the lock and metadata SHALL be unchanged

### Requirement: HOME canonicalization
The lock file (`server.lock`) and its metadata sidecar (`server.lock.meta.json`) SHALL be rooted on the `$HOME`-honouring dashboard directory (`<HOME>/.pi/dashboard`, the same root as the gateway socket and `config.json`), so that a process started under a temporary `HOME` gets a lock isolated from the user's real dashboard. Every writer and every reader of the lock or its metadata, the Electron shell included, SHALL resolve that same root. No reader SHALL use a root that differs from the writer's.

A canonical, `$HOME`-immune homedir (`os.userInfo().homedir` passed through `fs.realpathSync`, with `os.homedir()` as fallback) SHALL remain available for reasoning about `$HOME` drift. It SHALL NOT be used to locate the lock or its metadata.

#### Scenario: Temp HOME gets an isolated lock
- **WHEN** a dashboard is started with `HOME=/tmp/x`
- **THEN** its lock and metadata SHALL be written under `/tmp/x/.pi/dashboard/`
- **AND** a dashboard running under the user's real HOME SHALL keep its own lock, untouched

#### Scenario: Electron reads the lock where the server wrote it
- **WHEN** the server writes `server.lock.meta.json` under `<HOME>/.pi/dashboard/` for the `HOME` it was started with
- **AND** the Electron shell runs with the same `HOME`
- **THEN** the Electron lock-metadata reader SHALL read that same file

#### Scenario: Symlinked homedir canonicalizes
- **WHEN** the user's homedir is a symlink (e.g. `/Users/robson → /System/Volumes/Data/Users/robson` on macOS)
- **THEN** `canonicalHomedir()` SHALL return the realpath target consistently across invocations

#### Scenario: $HOME override ignored on POSIX
- **WHEN** a launcher exports `$HOME=/tmp/garbage`
- **THEN** `canonicalHomedir()` SHALL return the user's real home (via `getpwuid`), NOT `/tmp/garbage`
- **AND** the lock path SHALL be derived from `/tmp/garbage/.pi/dashboard` (the `$HOME`-honouring root), not from `canonicalHomedir()`

#### Scenario: Git Bash vs PowerShell on Windows
- **WHEN** `$HOME=/c/Users/R` (Git Bash) but `USERPROFILE=C:\Users\R` (PowerShell)
- **THEN** `canonicalHomedir()` SHALL use `USERPROFILE` (via `os.userInfo().homedir`) for both shells and return the same canonical path

### Requirement: Restart handoff
The restart orchestrator spawned by `/api/restart` SHALL explicitly terminate the previous daemon named by `server.pid`: it sends SIGTERM, waits up to 3 s for exit, and then sends SIGKILL. It SHALL then wait up to 5 s (10 × 500 ms) for the dashboard port to become free before spawning the replacement. It SHALL NOT poll the lock directory. A lock left behind by the killed daemon is reclaimed by the replacement's own acquisition, because the recorded holder PID is dead.

#### Scenario: Clean restart
- **WHEN** `POST /api/restart` fires
- **AND** the old server exits on SIGTERM
- **THEN** the orchestrator waits for the dashboard port to be free (≤5 s)
- **AND** spawns the new server, which acquires the lock as normal

#### Scenario: Restart with hung old server
- **WHEN** the old server does not exit within 3 s of SIGTERM
- **THEN** the orchestrator SHALL send SIGKILL, then wait for the port and spawn the replacement
- **AND** the replacement SHALL reclaim the stale lock, because the recorded holder PID is dead

#### Scenario: Old server survives SIGKILL
- **WHEN** the old server is still alive after SIGKILL (e.g. uninterruptible sleep), still holds the port, and does not answer `/api/health`
- **THEN** the replacement's lock acquisition SHALL fail with the unresponsive-holder error, leaving the lock and metadata unchanged
- **AND** the replacement SHALL then exit on its HTTP bind failure, without having modified the old server's lock, metadata or PID file

### Requirement: Server PID file remains advisory
The legacy `server-pid.ts` PID file (`~/.pi/dashboard/server.pid`) SHALL continue to be written after the HTTP port is bound, for back-compat with external tooling. The lock file is the authoritative source of instance identity. The lock metadata is written when the lock is acquired, which happens before the HTTP bind.

#### Scenario: PID file still written
- **WHEN** the dashboard starts and binds its HTTP port
- **THEN** both `server.pid` (via `writePid`) and `server.lock.meta.json` (via `acquireOrAttach`, when the lock is acquired) are written

#### Scenario: Conflict resolution
- **WHEN** the PID file and lock metadata disagree (e.g., old PID file lingers from a stale crash)
- **THEN** the lock metadata wins for identity, and the PID file is overwritten when the new server binds its HTTP port


### Requirement: Graceful release
On graceful shutdown (SIGINT, SIGTERM, SIGHUP, SIGBREAK, explicit `/api/shutdown`, explicit `/api/restart`), the dashboard SHALL release the lock and delete the metadata sidecar before exiting, unless its hold has been compromised by a successor. In that case, release SHALL leave the successor's lock and metadata untouched. The release MUST be idempotent so repeated signals do not double-release.

#### Scenario: SIGTERM triggers release
- **WHEN** the dashboard receives SIGTERM
- **THEN** the signal handler calls `release()` and removes `server.lock.meta.json`
- **AND** the process exits with code 0

#### Scenario: /api/shutdown triggers release
- **WHEN** a `POST /api/shutdown` is received
- **THEN** the route handler calls the injected `releaseLock()` callback before invoking `process.exit(0)`

#### Scenario: /api/restart hands off the lock
- **WHEN** a `POST /api/restart` is received
- **THEN** the route handler calls `releaseLock()` before spawning the orchestrator so the replacement process doesn't wait through stale detection

#### Scenario: Windows Ctrl+Break (SIGBREAK)
- **WHEN** the dashboard receives SIGBREAK on Windows
- **THEN** the release handler fires exactly once and the metadata sidecar is removed

#### Scenario: Hard kill leaves lock for stale detection
- **WHEN** the dashboard is killed with SIGKILL or `taskkill /F`
- **THEN** the lock directory and metadata remain (no signal handler runs)
- **AND** the next starter's liveness verdict finds the recorded PID dead and takes the lock over without waiting for the lock-file stale window

#### Scenario: Compromised holder leaves the successor's lock alone
- **WHEN** a dashboard whose hold was compromised shuts down gracefully
- **THEN** the successor's lock directory and `server.lock.meta.json` SHALL still exist afterwards

### Requirement: Metadata sidecar robustness
The metadata sidecar (`server.lock.meta.json`) SHALL be written atomically (tmp + rename). A missing or corrupt sidecar SHALL be treated as "assume stale" only when the lock directory has not been refreshed within the lock library's stale window. A sidecar that exists but cannot be read (permissions, I/O error) SHALL make acquisition refuse to take over the HOME.

#### Scenario: Atomic write survives crash mid-write
- **WHEN** the server crashes during metadata write
- **THEN** the on-disk metadata file is either the old valid version or the new valid version — never a partial write

#### Scenario: Corrupt metadata treated as stale
- **WHEN** the metadata file contains malformed JSON or schema-mismatched content
- **AND** the lock directory has not been refreshed within the stale window
- **THEN** `readMetadata()` returns `null`
- **AND** the lock holder is treated as stale
- **AND** the lock is taken over via compare-and-remove, acquire and claim

#### Scenario: Unreadable metadata refuses takeover
- **WHEN** the metadata file exists but reading it fails with a permission or I/O error
- **THEN** acquisition SHALL fail with an error naming the file, and the lock SHALL NOT be taken over

#### Scenario: Concurrent-launch race avoided via metadata-land poll
- **WHEN** two callers race on `acquireOrAttach`
- **AND** the winner has acquired the lock but has not yet written metadata
- **THEN** the loser polls the metadata file for up to 500ms (20 × 25ms)
- **AND** once the winner writes metadata, the loser returns `mode: "attach"` with the winner's identity
- **AND** if the winner has still written nothing but its lock directory is freshly refreshed, the loser SHALL NOT take over and SHALL signal the unresponsive-holder error with reason `starting`
