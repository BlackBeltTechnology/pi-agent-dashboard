## MODIFIED Requirements

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

## ADDED Requirements

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
