# headless-spawn Specification

## Purpose

Defines how the dashboard server spawns headless pi sessions (no TUI / no terminal owner). All headless spawns go through the keeper sidecar (`rpc-keeper-sidecar` capability) so pi survives dashboard server restarts on both Unix and Windows. The `headlessPidRegistry` tracks every spawned keeper+pi pair, persists to disk, and reclaims orphans on startup. Process-group kill semantics ensure cleanup terminates pi plus any descendants without leaving stragglers.
## Requirements
### Requirement: Headless spawn survives server restart (Unix)
On macOS and Linux, headless pi sessions SHALL be spawned via the keeper sidecar (see `rpc-keeper-sidecar` capability). The dashboard server SHALL spawn the keeper as a detached child process; the keeper SHALL spawn pi with `stdio: ["pipe", logFd, logFd]` and own pi's stdin pipe.

The keeper SHALL outlive the dashboard server. When the dashboard server exits, the keeper SHALL continue running with pi attached. When the new dashboard server starts, it SHALL discover the keeper via the socket-scan reconnect path (see `rpc-keeper-sidecar` Requirement "Server reconnect to existing keepers on startup") and resume RPC dispatch routing.

The keeper path is unconditional. There is no feature flag and no legacy non-keeper fallback. The previous `sh -c "tail -f /dev/null | pi --mode rpc"` shell wrapper is retired. Durability is provided by the keeper. The `headlessPidRegistry` SHALL track BOTH the keeper PID and the pi PID per session; the existing `byCwd / byPid / byToken` indexing handles the spawn-PID-vs-session-PID correlation as today (see `spawn-correlation` capability).

#### Scenario: Server exits while headless agent is running (Unix)
- **WHEN** the dashboard server exits (graceful `/api/shutdown` or SIGTERM) on macOS or Linux while a headless session is active
- **THEN** the session's keeper process SHALL continue running
- **AND** pi SHALL continue running with stdin still held by the keeper
- **AND** the bridge extension inside pi SHALL continue forwarding events over WebSocket (with reconnection backoff)

#### Scenario: New server reconnects to existing keeper on startup
- **WHEN** the new dashboard server starts and finds a `<sessionId>.rpc.sock` whose keeper PID and pi PID are both alive
- **THEN** the server SHALL register the session as RPC-dispatch-ready
- **AND** the server SHALL NOT spawn a new keeper for this session
- **AND** the server SHALL NOT kill the existing keeper or pi

#### Scenario: No legacy fallback when keeper spawn fails
- **WHEN** the keeper spawn itself fails (e.g. `node <path>/keeper.cjs` ENOENT, UDS bind error)
- **THEN** `spawnPiSession` SHALL return `{ success: false, code: "PI_CRASHED", ... }`
- **AND** no fallback to a legacy `tail -f /dev/null` wrapper SHALL be attempted

### Requirement: Headless spawn on Windows uses keeper for durability parity
On Windows, headless pi sessions SHALL be spawned via the same keeper sidecar pattern as Unix. The keeper SHALL listen on a Windows named pipe (`\\.\pipe\pi-rpc-<sessionId>`) and own pi's stdin via `stdio: ["pipe", logFd, logFd]`. The keeper path is unconditional on Windows — there is no fallback to direct-stdin piping from the dashboard server to pi.

This replaces the previous Windows behavior where the dashboard server piped pi's stdin directly, which meant pi died with the dashboard server on every restart. With the keeper as the only path, Windows now matches Unix unconditionally: pi survives across dashboard server restarts.

#### Scenario: Server exits while headless agent is running (Windows)
- **WHEN** the dashboard server exits on Windows while a headless session is active
- **THEN** the session's keeper process SHALL continue running
- **AND** pi SHALL continue running with stdin held by the keeper
- **AND** when the new server starts, it SHALL reconnect via the named-pipe scan

#### Scenario: No direct-stdin pipe from dashboard server to pi
- **WHEN** any headless session is spawned on Windows
- **THEN** the dashboard server SHALL NOT open a stdin pipe directly to the pi child
- **AND** all stdin writes destined for pi SHALL be routed through the keeper's named pipe

### Requirement: Headless spawn cleanup tracks keeper PIDs
The `headlessPidRegistry` SHALL track keeper PIDs alongside pi PIDs per session. The registry's existing `cleanupOrphans` pass SHALL be extended to:

1. Scan `~/.pi/dashboard/sessions/*.rpc.sock` (Unix) or named-pipe directory (Windows) for keepers.
2. For each keeper found: verify its PID is alive (via `isProcessAlive`) and its corresponding pi PID is alive.
3. Kill orphan keepers (alive keeper, dead pi) and unlink their socket + PID sidecar files.
4. Remove stale socket files where the keeper PID is dead.

The cleanup SHALL run on dashboard server startup BEFORE any new keepers are spawned.

#### Scenario: Cleanup removes orphan keeper after pi crash
- **GIVEN** a keeper for session `<sid>` is alive but its pi child has crashed
- **WHEN** the dashboard server starts
- **THEN** the cleanup pass SHALL send SIGTERM to the keeper PID
- **AND** SHALL unlink `<sid>.rpc.sock` and `<sid>.rpc.sock.pid`
- **AND** the session SHALL not be registered as RPC-dispatch-ready

### Requirement: Process group kill for headless agents
When terminating a headless agent (via `killBySessionId`, `killAll`, or orphan cleanup), the server SHALL escalate from SIGTERM to SIGKILL if the pi process does not exit within a 2-second grace window. On Unix the escalation SHALL target the entire process group via `process.kill(-pid, "SIGKILL")`; on Windows it SHALL use `taskkill /F /T /PID <pid>` (force, tree). The escalation SHALL be implemented by delegating to the shared platform helper `killProcess(pid, { timeoutMs: 2000 })` in `packages/shared/src/platform/process.ts` — `killBySessionId` SHALL NOT issue raw `SIGTERM`-only kills against pi.

For keeper-mediated entries (those with `keeperPid !== undefined`), `killBySessionId` SHALL kill the pi process first using `killProcess(piPid, { timeoutMs: 2000 })`. After scheduling the pi kill, `killBySessionId` SHALL schedule a fire-and-forget `setTimeout` 200 ms later that sends `SIGTERM` to the keeper PID; the keeper's own SIGTERM handler is reliable and does not require SIGKILL escalation at the registry layer. The function SHALL be `async` and return `Promise<boolean>`; all call sites (`handleShutdown`, `handleForceKill`, `handleKillProcess`) SHALL `await` it.

For non-keeper entries (legacy path; kept for orphan cleanup of pre-`enable-rpc-keeper-by-default` sessions still on disk), `killBySessionId` SHALL also use `killProcess(pid, { timeoutMs: 2000 })` so the SIGTERM→SIGKILL ladder is uniform across both branches.

#### Scenario: Kill headless agent by session ID (Unix, cooperative pi)
- **WHEN** the server sends a shutdown command for a headless session on macOS or Linux AND the pi process exits within 2 seconds of receiving SIGTERM
- **THEN** the server SHALL call `killProcess(piPid, { timeoutMs: 2000 })` which sends `process.kill(-pid, "SIGTERM")` and resolves on pi-exit observed before the timeout
- **AND** no SIGKILL SHALL be sent

#### Scenario: Kill headless agent by session ID (Unix, hung pi)
- **WHEN** the server sends a shutdown command for a headless session on macOS or Linux AND the pi process does NOT exit within 2 seconds of SIGTERM
- **THEN** `killProcess` SHALL escalate to `process.kill(-pid, "SIGKILL")` on the pi process group
- **AND** the keeper-fallback SIGTERM 200 ms timer SHALL still fire as today, sending SIGTERM to the keeper PID

#### Scenario: Kill headless agent by session ID (Windows, hung pi)
- **WHEN** the server sends a shutdown command for a headless session on Windows AND the pi process does NOT exit within 2 seconds of the initial kill attempt
- **THEN** `killProcess` SHALL invoke `taskkill /F /T /PID <piPid>` (force, tree) to terminate pi and any children

#### Scenario: Kill all headless agents on server stop
- **WHEN** the server calls `killAll()` during graceful shutdown
- **THEN** each tracked entry SHALL be killed via `killProcess(pid, { timeoutMs: 2000 })` (SIGTERM→2s→SIGKILL ladder) on Unix or `taskkill /F /T /PID` on Windows
- **AND** the calls MAY run in parallel via `Promise.all` since each `killProcess` is independent

#### Scenario: `killBySessionId` returns after pi has been confirmed dead or SIGKILLed
- **WHEN** `await headlessPidRegistry.killBySessionId(sessionId)` is called from a session-action handler
- **THEN** the returned promise SHALL resolve only after `killProcess`'s grace window has either observed pi exit or sent SIGKILL
- **AND** the resolved value SHALL be `true` when at least one kill (SIGTERM or SIGKILL) reached a previously-alive process and `false` when no entry existed for `sessionId`

### Requirement: Headless PID persistence to disk
The server SHALL persist headless process entries to `~/.pi/dashboard/headless-pids.json` using atomic writes. The file SHALL contain an array of entries with fields `pid` (number), `cwd` (string), and `spawnedAt` (ISO timestamp). Entries SHALL be written on register and removed on process exit or kill.

#### Scenario: Headless process spawned
- **WHEN** a headless pi session is spawned with PID 12345 in `/projects/app`
- **THEN** the server SHALL write an entry `{ pid: 12345, cwd: "/projects/app", spawnedAt: "..." }` to the PID file

#### Scenario: Headless process exits
- **WHEN** a tracked headless process exits
- **THEN** the server SHALL remove its entry from the PID file

#### Scenario: PID file is empty
- **WHEN** no headless processes are tracked
- **THEN** the PID file SHALL contain `{ "entries": [] }`

### Requirement: Orphan cleanup on server startup
On startup, the server SHALL read the headless PID file and check each entry. If the PID is still alive (`process.kill(pid, 0)` succeeds), the server SHALL reclaim it into the registry. If the PID is dead, the server SHALL remove the stale entry. If the PID is alive but was spawned more than 7 days ago, the server SHALL kill it (process group on Unix, direct on Windows) and remove the entry.

#### Scenario: Orphan process still alive
- **WHEN** the server starts and finds PID 12345 in the PID file and the process is still alive
- **THEN** the server SHALL add it to the headless registry for tracking

#### Scenario: Stale PID (process dead)
- **WHEN** the server starts and finds PID 12345 in the PID file but the process is not alive
- **THEN** the server SHALL remove the entry from the PID file

#### Scenario: Very old orphan killed
- **WHEN** the server starts and finds a PID spawned more than 7 days ago that is still alive
- **THEN** the server SHALL kill it (process group on Unix, direct on Windows) and remove the entry

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

### Requirement: `PI_DASHBOARD_SPAWN_TOKEN` env-var injected on every spawn
For every invocation of `spawnPiSession()` — regardless of strategy (`tmux`, `wt`, `wsl-tmux`, `headless`) and regardless of platform — the server SHALL inject `PI_DASHBOARD_SPAWN_TOKEN` (a freshly-minted UUIDv4) into the spawned process's environment via `buildSpawnEnv`. The injection SHALL be the only mechanism by which the spawn token reaches the spawned pi process; the token SHALL NOT be passed via argv, the session JSONL file, or any other channel.

The `buildSpawnEnv(baseEnv, opts?)` function SHALL accept an optional `spawnToken: string` argument and SHALL set `result.PI_DASHBOARD_SPAWN_TOKEN = spawnToken` when provided. The existing `prependManagedNodeToPath` and other env-shaping behaviors SHALL be preserved unchanged.

#### Scenario: Headless spawn injects token
- **WHEN** `spawnPiSession(cwd, { strategy: "headless", spawnToken: "tok_h" })` is called on Linux or macOS
- **THEN** the spawned `sh -c "sleep ... | pi --mode rpc"` process SHALL have `PI_DASHBOARD_SPAWN_TOKEN=tok_h` in its environment
- **AND** the bridge running inside that pi process SHALL be able to read the token via `process.env.PI_DASHBOARD_SPAWN_TOKEN`

#### Scenario: Tmux spawn injects token
- **WHEN** `spawnPiSession(cwd, { strategy: "tmux", spawnToken: "tok_t" })` is called
- **THEN** the spawned tmux pane's pi process SHALL have `PI_DASHBOARD_SPAWN_TOKEN=tok_t` in its environment
- **AND** the bridge running inside that pi process SHALL be able to read the token

#### Scenario: Windows headless injects token
- **WHEN** `spawnPiSession(cwd, { strategy: "headless", spawnToken: "tok_w" })` is called on Windows
- **THEN** the directly-spawned `pi` process SHALL have `PI_DASHBOARD_SPAWN_TOKEN=tok_w` in its environment

#### Scenario: WT and WSL-tmux strategies inject token
- **WHEN** `spawnPiSession(cwd, { strategy: "wt", spawnToken: "tok_x" })` or `{ strategy: "wsl-tmux", spawnToken: "tok_y" }` is called
- **THEN** the spawned terminal-hosted pi process SHALL have `PI_DASHBOARD_SPAWN_TOKEN` in its environment

#### Scenario: Existing env vars preserved
- **WHEN** the dashboard server's environment contains `PATH`, `HOME`, `PI_DASHBOARD_URL`, etc.
- **THEN** the spawned process SHALL receive all of those vars unchanged in addition to `PI_DASHBOARD_SPAWN_TOKEN`

#### Scenario: Token not echoed to argv
- **WHEN** the server inspects the spawned process command-line via `ps` or equivalent
- **THEN** the spawn token SHALL NOT appear as an argv element

#### Scenario: Spawn without token (auto-resume disabled mode, future)
- **WHEN** `spawnPiSession` is called without a `spawnToken` argument (legacy callers)
- **THEN** the spawn SHALL proceed and `PI_DASHBOARD_SPAWN_TOKEN` SHALL NOT be set in the spawned process's env
- **AND** the bridge SHALL omit `spawnToken` from `session_register`, falling through to pid-link or cwd-FIFO at the server side

### Requirement: Headless spawn forwards a caller-supplied environment

A headless spawn SHALL accept an optional caller-supplied environment map and
forward it into the spawned process's environment. This caller env SHALL be
merged with the guard environment such that neither source overwrites the other's
distinct keys, and on any key collision the guard environment SHALL take
precedence over the caller-supplied value. When no caller env is supplied, the
spawned process environment SHALL be byte-identical to the environment produced
without this feature.

#### Scenario: Caller env reaches the spawned process

- **WHEN** a headless spawn is requested with a caller-supplied environment map
- **THEN** each supplied key SHALL be present with its supplied value in the
  spawned process's environment

#### Scenario: Guard env wins on key collision

- **WHEN** a guarded headless spawn is requested with a caller-supplied env whose
  key also appears in the guard environment
- **THEN** the spawned process SHALL receive the guard environment's value for
  that key, not the caller-supplied value

#### Scenario: No caller env is a no-op

- **WHEN** a headless spawn is requested without a caller-supplied env
- **THEN** the spawned process environment SHALL be unchanged from prior behavior
### Requirement: Headless spawn sets session name at creation via --name

`sessionFlagsToArgv(flags)` — defined in `packages/shared/src/platform/spawn-mechanism.ts` — SHALL accept an optional `name` field on `SessionFlags` and SHALL emit `["--name", flags.name]` when it is a non-empty string (pi 0.78.0+, verified present in the pinned pi CLI). The `--name` argv SHALL compose with the existing `--session` / `--fork` / `--model` flags. When `flags.name` is absent the argv SHALL be unchanged and post-hoc auto-naming SHALL still apply.

#### Scenario: Named spawn passes --name
- **WHEN** `sessionFlagsToArgv({ name: "review-worktree" })` is called
- **THEN** the result SHALL include `"--name"` followed by `"review-worktree"`
- **AND** the flag SHALL be forwarded through `buildHeadlessArgs` to the keeper spawn argv

#### Scenario: --name composes with fork and model flags
- **WHEN** `sessionFlagsToArgv({ name: "x", sessionFile: "/s.jsonl", fork: true, model: "m" })` is called (the fork+model return path)
- **THEN** the result SHALL include `--name x` alongside `--fork /s.jsonl` and `--model m`
- **AND** `--name` SHALL be present in the continue/`--session` return path as well

#### Scenario: Unnamed spawn unchanged
- **WHEN** `sessionFlagsToArgv({})` is called with no `name`
- **THEN** the result SHALL NOT include `--name`
- **AND** post-hoc auto-naming SHALL proceed as today

### Requirement: Pi PID capture SHALL follow an identity-bearing resolution only

For a keeper-mode registry entry (`keeperPid !== undefined`), the registry SHALL record
`entry.piPid` from a `session_register` that resolves that entry **when, and only when, the
resolution was identity-bearing** — that is, performed by the spawn-token tier or the
pid-matching tier. Both match on a value unique to the session.

The cwd-FIFO tier SHALL NEVER cause `piPid` to be recorded, irrespective of how many candidate
entries existed. That tier matches on arrival order within a cwd, so the entry it selects is not
known to belong to the registering session — a lone unlinked entry may belong to a session that
has not registered yet. Recording there would persist a PID belonging to a different session and
grant `killBySessionId` false confidence. Entries linked only by cwd-FIFO SHALL obtain their pi
PID from the keeper's pi-PID sidecar instead.

When the register carries no pid, the registry SHALL link as before and leave `piPid` unset.

Note: for a keeper-mode entry the spawn-time `pid` is the keeper's PID and the register carries
pi's PID, so the two always differ. Any "pid differs" condition is a type-correctness assertion,
not a safety discriminator, and SHALL NOT be relied on to prevent a wrong capture.

The registry SHALL persist the entry after recording `piPid`.

#### Scenario: Pid-tier resolution captures piPid

- **GIVEN** a keeper-mode entry with `keeperPid = K`, `pid = K`, and `piPid` unset
- **WHEN** a `session_register` carrying `pid = P` resolves that entry via the pid-matching tier
- **THEN** the registry SHALL set `entry.piPid = P` and persist the entry

#### Scenario: Single-candidate cwd-FIFO resolution SHALL NOT capture piPid

- **GIVEN** exactly one unlinked keeper-mode entry for cwd `C`
- **WHEN** a `session_register` for cwd `C` carrying `pid = P` resolves it via the cwd-FIFO tier
- **THEN** the registry SHALL leave `piPid` unset on that entry
- **AND** the registry SHALL report the positional resolution

#### Scenario: Multi-candidate cwd-FIFO resolution SHALL NOT capture piPid

- **GIVEN** two unlinked keeper-mode entries for cwd `C`
- **WHEN** a `session_register` for cwd `C` carrying `pid = P` resolves one of them via the cwd-FIFO tier
- **THEN** the registry SHALL leave `piPid` unset on that entry
- **AND** the registry SHALL report the positional resolution

#### Scenario: Register without a pid leaves piPid unset

- **GIVEN** a keeper-mode entry with `piPid` unset
- **WHEN** a `session_register` carrying no pid resolves it
- **THEN** the entry SHALL be linked as before
- **AND** `piPid` SHALL remain unset

#### Scenario: Non-keeper entries are unaffected

- **GIVEN** a non-keeper entry (`keeperPid === undefined`)
- **WHEN** any tier resolves it
- **THEN** `piPid` SHALL remain undefined
- **AND** pid consumers SHALL continue to fall back to `entry.pid`

### Requirement: The keeper's pi-PID sidecar SHALL fill an absent `piPid`

The pi PID recorded by the keeper after spawning pi SHALL be used to populate `entry.piPid` for
entries that do not have one — the reclaimed and cwd-FIFO-linked populations.

The sidecar SHALL NOT override a `piPid` already established by an identity-bearing capture. A
capture from the spawn-token or pid-matching tier can only occur while pi is alive, so it names
the same process the sidecar does; treating the file as an arbiter over the stronger per-spawn
secret would invert the trust order without any reachable disagreement to resolve.

When the sidecar is absent, unreadable, or unparseable, the registry SHALL leave `piPid` exactly
as it was.

The registry SHALL NOT infer a pi PID from a cwd, a process name, or a process-tree enumeration.

#### Scenario: Sidecar fills an absent piPid

- **GIVEN** an entry with `piPid` unset and a live keeper
- **AND** the keeper's pi-PID sidecar contains a live PID `Y`
- **WHEN** keeper discovery runs
- **THEN** the registry SHALL set `entry.piPid = Y` and persist it

#### Scenario: Sidecar does not override an existing piPid

- **GIVEN** an entry persisting `piPid = X`
- **WHEN** keeper discovery reads a pi-PID sidecar for that session
- **THEN** `entry.piPid` SHALL remain `X`

#### Scenario: Absent sidecar leaves the entry untouched

- **GIVEN** an entry and no readable pi-PID sidecar
- **WHEN** keeper discovery runs
- **THEN** `entry.piPid` SHALL be left exactly as it was

#### Scenario: Unparseable sidecar never produces a guess

- **GIVEN** a pi-PID sidecar whose contents do not parse as a positive integer
- **WHEN** keeper discovery runs
- **THEN** the registry SHALL leave `piPid` unchanged
- **AND** SHALL NOT derive a PID from any other source

### Requirement: A recorded pi PID SHALL be liveness-checked before it is trusted

A PID that names a dead process is a latent hazard: OS PID reuse can turn it into a live,
unrelated process that a later kill would terminate. The server SHALL verify that a pi PID read
from a sidecar refers to a live process before recording it during discovery.

This check rejects a PID naming a dead process. It SHALL NOT be relied on to detect a PID that
has already been reused by an unrelated live process, which passes a liveness test. The residual
window spans pi's death until the keeper unlinks its sidecar during shutdown.

#### Scenario: Dead pi PID is not recorded

- **GIVEN** a pi-PID sidecar containing PID `P`
- **AND** `P` is not alive
- **WHEN** keeper discovery runs
- **THEN** the registry SHALL NOT record `P`
- **AND** the condition SHALL be observable

#### Scenario: A missing sidecar SHALL NOT be treated as a dead pi

- **GIVEN** a live keeper with no pi-PID sidecar, because the write failed or it predates this change
- **WHEN** keeper discovery evaluates pi liveness for that session
- **THEN** the liveness result SHALL be "alive"
- **AND** the server SHALL NOT terminate the keeper on the basis of the missing file

#### Scenario: Live pi PID is recorded

- **GIVEN** a pi-PID sidecar containing a live PID `P` for a live keeper
- **WHEN** keeper discovery runs
- **THEN** the registry SHALL record `entry.piPid = P`

### Requirement: Positional resolution of a keeper session SHALL be reported

The cwd-FIFO tier selects by arrival order, so a keeper session resolved that way had its identity
decided by position rather than by any value unique to it. The server SHALL report whenever the
cwd-FIFO tier resolves a keeper-mode entry.

The report SHALL NOT be interpreted as a mis-map count. Nothing at that point knows the true owner
of the entry — that is precisely why the tier is untrusted for capture — so the signal records
that identity was decided positionally, not that it was decided wrongly.

A cwd-FIFO call that matches nothing SHALL NOT be reported.

#### Scenario: Positional resolution of a keeper entry is reported

- **GIVEN** one or more unlinked keeper-mode entries sharing cwd `C`
- **WHEN** a `session_register` for cwd `C` resolves one of them via the cwd-FIFO tier
- **THEN** the server SHALL report the positional resolution naming the cwd and the resolved entry

#### Scenario: Non-matching cwd-FIFO call is not reported

- **GIVEN** a `session_register` for a cwd with no keeper-mode entry
- **WHEN** the register falls through to the cwd-FIFO tier and matches nothing
- **THEN** the server SHALL NOT report a mis-map risk

