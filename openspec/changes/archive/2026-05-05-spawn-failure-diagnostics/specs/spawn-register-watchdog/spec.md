## ADDED Requirements

### Requirement: Watchdog tracks spawned sessions until session_register or timeout
The module `packages/server/src/spawn-register-watchdog.ts` SHALL export a class `SpawnRegisterWatchdog` with `arm({ pid?, cwd, mechanism, logPath?, ws })`, `clearByPid(pid)`, `clearByCwd(cwd)`, and a constructor accepting `timeoutMs` (default `30000`, sourced from `config.spawnRegisterTimeoutMs`, clamped to `[5000, 120000]`).

The watchdog SHALL maintain two internal maps:
- `byCwd: Map<string, Entry>` — primary index, populated for every armed entry.
- `byPid: Map<number, Entry>` — secondary index, populated only when `pid` is provided.

On `arm`, the entry SHALL be indexed in `byCwd` unconditionally; when `pid` is provided the same entry SHALL additionally be indexed in `byPid`. Indexing in both maps is required because the PID reported at arm time can differ from the PID reported in `session_register` — e.g. on Unix the headless mechanism wraps pi in `sh -c "tail -f /dev/null | pi …"`, so `SpawnResult.pid` is the `sh` wrapper while the bridge later registers with pi's actual `process.pid`. Either `clearByPid(pid)` or `clearByCwd(cwd)` SHALL therefore be sufficient to cancel the watchdog.

A `setTimeout(timeoutMs)` SHALL be started for every armed entry. Each `clear*` call SHALL cancel the timer and remove the entry from BOTH maps when the entry it points to is the same arm (identity comparison). Clearing an unknown key SHALL be a no-op. On timer fire, the watchdog SHALL emit `spawn_register_timeout` to the stored `ws` and remove the entry from both maps. If a subsequent `arm` reuses an existing `cwd` (or `pid`), any prior pending timer for that key SHALL be cancelled before the new entry is installed.

#### Scenario: headless arm then clearByPid clears watchdog
- **WHEN** `watchdog.arm({ pid: 123, cwd, mechanism: "headless", ws })` is called and `watchdog.clearByPid(123)` is called within `timeoutMs`
- **THEN** the timer SHALL be cancelled and no `spawn_register_timeout` SHALL be sent

#### Scenario: tmux arm then clearByCwd clears watchdog
- **WHEN** `watchdog.arm({ cwd: "/p/x", mechanism: "tmux", ws })` is called (no pid) and `watchdog.clearByCwd("/p/x")` is called within `timeoutMs`
- **THEN** the timer SHALL be cancelled and no `spawn_register_timeout` SHALL be sent

#### Scenario: headless arm with pid then clearByCwd (pid mismatch) clears watchdog
- **WHEN** `watchdog.arm({ pid: 51250, cwd: "/p/x", mechanism: "headless", ws })` is called and `watchdog.clearByCwd("/p/x")` is called within `timeoutMs` (the bridge registered with pi's actual pid, not the `sh` wrapper pid stored at arm time)
- **THEN** the timer SHALL be cancelled and no `spawn_register_timeout` SHALL be sent
- **AND** the entry SHALL be removed from BOTH `byPid` and `byCwd`

#### Scenario: arm without register fires watchdog
- **WHEN** `watchdog.arm(...)` is called and neither `clearByPid` nor `clearByCwd` is called within `timeoutMs`
- **THEN** the watchdog SHALL send `{ type: "spawn_register_timeout", cwd, pid?, stderrTail? }` to `ws`
- **AND** the entry SHALL be removed from the indexing map

#### Scenario: clear on unknown key is no-op
- **WHEN** `watchdog.clearByPid(999)` or `watchdog.clearByCwd("/never/seen")` is called
- **THEN** the call SHALL return without throwing

#### Scenario: timeout fires after ws closed
- **WHEN** the timer fires and `ws.readyState !== OPEN`
- **THEN** the watchdog SHALL silently skip the send and remove the entry

#### Scenario: stderrTail attached when logPath provided and readable
- **WHEN** `watchdog.arm({ ..., logPath: <existing log> })` is called and the timeout fires
- **THEN** the emitted `spawn_register_timeout` SHALL include `stderrTail` containing the last 4096 bytes of `logPath`

#### Scenario: timeoutMs sourced from config and clamped
- **WHEN** the watchdog is constructed with `timeoutMs: 1000`
- **THEN** the effective timeout SHALL be `5000` (clamped to lower bound)

- **WHEN** the watchdog is constructed with `timeoutMs: 999999`
- **THEN** the effective timeout SHALL be `120000` (clamped to upper bound)

### Requirement: Late-register recovery emits spawn_register_recovered
The watchdog SHALL maintain a `recentlyFired: Map<string /*cwd*/, { firedAt: number; pid?: number; ws: WebSocket }>` with a 60 s TTL. When `clearByPid` or `clearByCwd` is invoked for a key whose entry was already removed by a fired timer (i.e. found in `recentlyFired`), the watchdog SHALL emit `{ type: "spawn_register_recovered", cwd, pid? }` to the originally-stored `ws` and delete the `recentlyFired` entry.

#### Scenario: late session_register emits recovery message
- **WHEN** the watchdog timer fires for `cwd: "/p/x"` and 5 s later `clearByCwd("/p/x")` is called
- **THEN** the watchdog SHALL emit `{ type: "spawn_register_recovered", cwd: "/p/x", pid? }` to the originating `ws`

#### Scenario: recovery beyond TTL is silent
- **WHEN** the watchdog timer fires and 61 s elapse before any clear call for that key
- **THEN** the `recentlyFired` entry SHALL have been evicted and no recovery message SHALL be emitted

#### Scenario: recovery skipped when ws closed
- **WHEN** late clear arrives within TTL but `ws.readyState !== OPEN`
- **THEN** the recovery message SHALL be skipped silently and `recentlyFired` entry deleted

### Requirement: Pi gateway clears watchdog on session_register
The pi-gateway message handler for `session_register` SHALL call BOTH `watchdog.clearByPid(pid)` (when a `pid` field is present) AND `watchdog.clearByCwd(cwd)` so headless and terminal-based spawns are both cleared. Order: `clearByPid` first, then `clearByCwd`. Both calls SHALL precede any handler logic that could throw.

#### Scenario: bridge registers headless session
- **WHEN** the pi gateway receives `session_register { pid: 123, cwd: "/p/x" }`
- **THEN** `watchdog.clearByPid(123)` SHALL be invoked
- **AND** `watchdog.clearByCwd("/p/x")` SHALL be invoked

#### Scenario: bridge registers tmux session (no pid the dashboard owns)
- **WHEN** the pi gateway receives `session_register { cwd: "/p/x" }` with no relevant pid (or with a pid that was never armed)
- **THEN** `watchdog.clearByPid` SHALL be a no-op and `watchdog.clearByCwd("/p/x")` SHALL clear the tmux watch

### Requirement: Handler arms watchdog for every successful spawn
`session-action-handler.handleSpawnSession` SHALL call `watchdog.arm` exactly once after a successful spawn. For headless mechanisms (`pid` present) the entry SHALL include `pid`. For tmux/wt/wsl-tmux (no `pid`) the entry SHALL be cwd-keyed only.

#### Scenario: headless spawn arms watchdog with pid
- **WHEN** `handleSpawnSession` receives `SpawnResult { success: true, pid: 123, process }` from a headless spawn
- **THEN** `watchdog.arm({ pid: 123, cwd, mechanism: "headless", logPath: result.logPath, ws })` SHALL be called once
- **AND** the entry SHALL be reachable via BOTH `clearByPid(123)` AND `clearByCwd(cwd)` (the spawner's pid may not match the bridge's reported pid on Unix headless)

#### Scenario: tmux spawn arms watchdog by cwd only
- **WHEN** `handleSpawnSession` receives `SpawnResult { success: true }` from a tmux/wt/wsl-tmux spawn (no `pid`)
- **THEN** `watchdog.arm({ cwd, mechanism, ws })` SHALL be called once with no `pid`
