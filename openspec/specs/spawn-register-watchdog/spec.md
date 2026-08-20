# spawn-register-watchdog

## Purpose

Per-spawn watchdog timer that tracks every spawned pi session until either (a) the bridge sends `session_register`, or (b) a configurable timeout elapses. On timeout it emits `spawn_register_timeout` to the originating browser; if a late `session_register` arrives within a 60 s recovery window, it emits `spawn_register_recovered`. Indexed by both pid and cwd because the spawner pid (e.g. `sh` wrapper) often differs from the pid the bridge later reports.
## Requirements
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
The watchdog SHALL maintain a `recentlyFired` map whose TTL is a recovery grace window. That window SHALL be a single named constant exported from one shared module and imported by BOTH the watchdog (for `recentlyFired` eviction) and every register-path TTL derivation; no separate literal SHALL exist at any of those sites. The recovery window SHALL NOT vary with `spawnRegisterTimeoutMs` — changing the timeout SHALL move only the fire instant, never the length of the window that follows it.

Each fired entry SHALL occupy **exactly one** `recentlyFired` index: its `spawnToken` when it has one, its `cwd` when it does not. A fire SHALL NOT overwrite a pending recovery entry belonging to a different concurrent spawn, and one fire SHALL produce at most one recovery message.

When `clearByToken`, `clearByPid` or `clearByCwd` is invoked for a key whose entry was already removed by a fired timer (i.e. found in `recentlyFired`), the watchdog SHALL emit `{ type: "spawn_register_recovered", cwd, pid? }` to the originally-stored `ws` and delete the `recentlyFired` entry.

The recovered message SHALL NOT carry a `requestId`. The watchdog cannot obtain one without reading correlation state it is forbidden to touch, and `session_added` carries the value instead.

Recovery is reachable only when the fire-time reclaim did not terminate the spawned process; the watchdog SHALL NOT change reclaim behaviour to make recovery more likely.

#### Scenario: late session_register emits recovery message
- **WHEN** the watchdog timer fires for `cwd: "/p/x"` and 5 s later `clearByCwd("/p/x")` is called
- **THEN** the watchdog SHALL emit `{ type: "spawn_register_recovered", cwd: "/p/x", pid? }` to the originating `ws`

#### Scenario: recovery window is independent of the configured timeout
- **WHEN** the watchdog is armed with `timeoutMs: 90000`
- **AND** a clear arrives 30 s after the fire
- **THEN** the recovery message SHALL still be emitted

#### Scenario: Concurrent same-cwd fires do not clobber each other
- **WHEN** two spawns with distinct tokens are armed for the same `cwd` and both fire
- **THEN** `recentlyFired` SHALL hold a recovery entry for each, indexed by token
- **AND** a late `clearByToken` for the first SHALL emit exactly one recovery and SHALL leave the second's entry intact

#### Scenario: A token-bearing fired entry is not reachable by cwd
- **WHEN** an entry with a `spawnToken` fires
- **AND** `clearByCwd` is called for its `cwd` with no matching token
- **THEN** no recovery SHALL be emitted for that entry
- **AND** its token-keyed entry SHALL remain until a token clear or TTL eviction

#### Scenario: recovery beyond TTL is silent
- **WHEN** the watchdog timer fires and the recovery grace window fully elapses before any clear call for that key
- **THEN** the `recentlyFired` entry SHALL have been evicted and no recovery message SHALL be emitted

#### Scenario: recovery skipped when ws closed
- **WHEN** late clear arrives within TTL but `ws.readyState !== OPEN`
- **THEN** the recovery message SHALL be skipped silently and the `recentlyFired` entry deleted

### Requirement: Pi gateway clears watchdog on session_register
The pi-gateway `session_register` handler SHALL clear the watchdog for the registering spawn, trying the strongest identity first: `spawnToken`, then `pid`, then `cwd`.

A clear that has already matched on a stronger tier SHALL NOT go on to cancel an entry belonging to a **different** spawn on a weaker tier. Specifically, an unconditional `clearByCwd` after a successful token clear SHALL NOT cancel a concurrent same-cwd spawn's still-armed watchdog — doing so silently disarms that spawn, suppressing both its timeout diagnostic and its reclaim.

Clearing an unknown key SHALL remain a no-op.

#### Scenario: Token clear does not disarm a concurrent same-cwd spawn
- **WHEN** spawns A and B are armed for the same `cwd` with distinct tokens
- **AND** A registers carrying its token
- **THEN** A's watchdog SHALL be cancelled
- **AND** B's watchdog SHALL remain armed and SHALL still fire if B never registers

#### Scenario: cwd tier still clears a token-less spawn
- **WHEN** a tmux spawn armed without a token or pid registers with only its `cwd`
- **THEN** the cwd tier SHALL cancel that watchdog

#### Scenario: Clear on unknown key is a no-op
- **WHEN** a register arrives whose token, pid and cwd match no armed entry
- **THEN** the handler SHALL return without throwing and without cancelling any entry

### Requirement: Handler arms watchdog for every successful spawn
`handleSpawnSession` SHALL call `watchdog.arm` exactly once after a successful spawn, passing the pid it actually has — for headless spawns that is the keeper pid returned by `spawnPiSession`. The arm SHALL NOT be required to supply pi's pid, which does not exist when the spawn call returns, and SHALL NOT block or poll waiting for it.

The timeout passed to `arm` SHALL come from the same configuration read that derives the TTLs recorded for that spawn.

Every `cwd` SHALL pass through one shared normalizer before being used as a key, at BOTH arm time and clear time, so that path aliases (e.g. `/tmp` vs `/private/tmp`) resolve to the same key. When a path cannot be resolved for any reason, the raw string SHALL be used unchanged.

#### Scenario: headless spawn arms with the pid it has
- **WHEN** `handleSpawnSession` completes a headless spawn whose keeper pid is `22484`
- **THEN** `watchdog.arm` SHALL be called with `pid: 22484`
- **AND** the arm SHALL NOT wait for pi's pid to become known

#### Scenario: aliased cwd still clears
- **WHEN** the watchdog is armed with `cwd: "/tmp/x"`
- **AND** the bridge registers with `cwd: "/private/tmp/x"`
- **THEN** the normalized keys SHALL match and the cwd tier SHALL cancel the watchdog

#### Scenario: unresolvable cwd falls back to the raw string
- **WHEN** the watchdog is armed with a `cwd` that cannot be resolved on disk
- **THEN** the raw string SHALL be used as the key
- **AND** a clear with the identical raw string SHALL cancel the watchdog

#### Scenario: tmux spawn arms watchdog by cwd only
- **WHEN** `handleSpawnSession` receives `SpawnResult { success: true }` from a tmux/wt/wsl-tmux spawn (no `pid`)
- **THEN** `watchdog.arm({ cwd, mechanism, ws })` SHALL be called once with no `pid`

### Requirement: Watchdog tracks spawned sessions with three indices: token, pid, cwd
The `SpawnRegisterWatchdog` SHALL maintain a third internal index alongside the existing `byCwd` and `byPid` maps:

- `byToken: Map<string, Entry>` — populated when `spawnToken` is provided to `arm`.

The `arm` signature SHALL be extended to accept `spawnToken?: string` and the
effective `timeoutMs?: number` for THIS spawn (absent ⇒ the instance default):

```ts
arm({ pid?, cwd, mechanism, logPath?, ws, spawnToken?, timeoutMs? }): void
```

`timeoutMs` is part of the documented API because every TTL recorded for a spawn
derives from the same value that armed it; a caller that cannot pass the value
it read cannot honour that rule.

The `armSpawnWatchdog(cwd, mechanism, result, ws?, timeoutMs?)` helper — the
entry point every spawn path uses — SHALL RETURN the clamped timeout it armed
with, or `undefined` when it armed nothing (a failed spawn):

```ts
armSpawnWatchdog(cwd, mechanism, result, ws?, timeoutMs?): number | undefined
```

Returning it is what closes the loop: a caller with no config read of its own
still derives its TTLs from the value that ACTUALLY armed the watchdog, rather
than from a second read that a live Settings change can desynchronize. The
instance method `arm` itself returns `void` — its caller already holds the value
it passed in.

When `spawnToken` is provided at arm time, the entry SHALL be indexed in `byToken` in addition to `byCwd` and (if `pid` is provided) `byPid`. All three indices SHALL point to the same `Entry` object.

A new `clearByToken(token)` method SHALL be exposed. It SHALL cancel the entry's timer and remove the entry from ALL THREE maps when invoked. Like `clearByPid` / `clearByCwd`, calling `clearByToken` with an unknown key SHALL be a no-op.

The pi-gateway `session_register` handler SHALL invoke clears in priority order — `clearByToken(msg.spawnToken)` (when present), then `clearByPid(msg.pid)` (when present), then `clearByCwd(msg.cwd)` — and SHALL STOP at the first clear that reports it claimed an entry. Each `clearBy*` SHALL report whether it claimed one. A clear that already succeeded on a stronger tier SHALL NOT fall through to a weaker one: with two concurrent same-cwd spawns, falling through cancels the OTHER spawn's arm, so a spawn that never registers is never diagnosed and never reclaimed. Invoking a `clear*` on an already-removed index SHALL remain a safe no-op.

#### Scenario: Token clear cancels the watchdog
- **WHEN** `watchdog.arm({ cwd: "/p", spawnToken: "tok_a", pid: 100, mechanism: "headless", ws })` is called
- **AND** `watchdog.clearByToken("tok_a")` is called within `timeoutMs`
- **THEN** the timer SHALL be cancelled
- **AND** the entry SHALL be removed from `byToken`, `byCwd`, and `byPid`
- **AND** no `spawn_register_timeout` SHALL be emitted

#### Scenario: Token-clear is idempotent across cleared indices
- **WHEN** `clearByToken("tok_a")` has already removed the entry
- **AND** `clearByPid(100)` is then called for the same pid
- **THEN** the second call SHALL be a no-op (entry already removed)

#### Scenario: Tmux arm with token uses token clear
- **WHEN** `watchdog.arm({ cwd: "/p", spawnToken: "tok_b", mechanism: "tmux", ws })` (no pid) is called
- **AND** `watchdog.clearByToken("tok_b")` is called
- **THEN** the timer SHALL be cancelled and `byToken` and `byCwd` SHALL no longer contain the entry

#### Scenario: Legacy spawn without token still works
- **WHEN** `watchdog.arm({ cwd: "/p", pid: 100, mechanism: "headless", ws })` (no spawnToken) is called
- **THEN** only `byCwd` and `byPid` SHALL contain the entry
- **AND** existing `clearByPid` / `clearByCwd` semantics SHALL be unchanged

#### Scenario: Token reuse cancels prior arm
- **WHEN** `arm({ ..., spawnToken: "tok_x" })` is called twice with the same token (programmatic mistake)
- **THEN** the first arm's timer SHALL be cancelled before the second arm installs its entry
- **AND** all three indices SHALL point to the second arm's entry

### Requirement: Late-recovery window keyed by token
The watchdog's `recentlyFired` map SHALL also key by `spawnToken` when the fired entry had one. When a late `clearByToken` is called for a key in `recentlyFired`, the watchdog SHALL emit `spawn_register_recovered { cwd, pid? }` to the originally-stored `ws` exactly as it does for late `clearByPid` / `clearByCwd` cases. The message SHALL NOT carry a `requestId`: the watchdog has no access to the correlation map and must not acquire it, and `session_added` is what carries the value.

#### Scenario: Late token-bearing register triggers recovery
- **WHEN** a watchdog entry with `spawnToken: "tok_y"` fires its timeout (entering `recentlyFired`)
- **AND** `clearByToken("tok_y")` is called within 60s after the fire
- **THEN** a `spawn_register_recovered` event SHALL be emitted to the original `ws`

### Requirement: Watchdog fire and recovery are observable
The watchdog SHALL write a log line on every timer fire and on every recovery
emission, so both are visible in `server.log`. Neither path is logged today.
Each line SHALL identify the spawn by `cwd`, and by `pid` and `spawnToken` when
known, and the recovery line SHALL state which index tier matched (`token`,
`pid` or `cwd`).

Every record of a fire — logged and persisted — SHALL name the timeout that
actually applied to that entry, not a value captured when the watchdog was
constructed, which is stale after a live Settings change.

Entries appended to `spawn-failures.log` for a `REGISTER_TIMEOUT` SHALL carry the
`spawnToken` when the fired entry had one, so a later recovery can be joined to
the specific fire it belongs to. `cwd` SHALL NOT be relied on as the join key,
being ambiguous under concurrent same-cwd spawns, nor `pid`, which is absent for
tmux spawns.

#### Scenario: Fire is logged
- **WHEN** the watchdog timer fires for a spawn
- **THEN** a log line SHALL be written naming the `cwd`, and the `pid` and `spawnToken` when known

#### Scenario: The recorded timeout is the one that applied
- **WHEN** an entry armed with an effective timeout of `90000` fires while the watchdog was constructed with `30000`
- **THEN** both the logged line and the persisted failure entry SHALL name `90000`

#### Scenario: Recovery is logged with the matching tier
- **WHEN** a late `clearByToken` produces a `spawn_register_recovered`
- **THEN** a log line SHALL be written naming the `cwd` and identifying the matched tier as `token`

#### Scenario: Failure log entry carries a join key
- **WHEN** a `REGISTER_TIMEOUT` is appended for a fired entry that had a `spawnToken`
- **THEN** the appended entry SHALL include that `spawnToken`

#### Scenario: Failure log distinguishes recovered timeouts
- **WHEN** a `REGISTER_TIMEOUT` was written and that same spawn later recovered inside the recovery window
- **THEN** a recovery record bearing the matching `spawnToken` SHALL be appended
- **AND** a timeout that never recovered SHALL remain distinguishable from it
- **AND** the append-only, rotating shape of the log SHALL be preserved — no in-place edit of the earlier entry is required

#### Scenario: Concurrent same-cwd timeouts stay distinguishable
- **WHEN** two spawns in the same `cwd` both time out and only one later recovers
- **THEN** the recovery SHALL be recorded against exactly one entry, selected by token

