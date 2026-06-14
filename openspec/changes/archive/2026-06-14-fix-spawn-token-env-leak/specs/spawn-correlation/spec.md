## MODIFIED Requirements

### Requirement: Bridge reads `PI_DASHBOARD_SPAWN_TOKEN` and includes it on first register only
The bridge extension SHALL read `process.env.PI_DASHBOARD_SPAWN_TOKEN` at registration time. The bridge SHALL include `spawnToken` in `session_register` IFF `bc.hasRegisteredOnce === false` (the very first register for this bridge process). For all subsequent registers — including reattach (after dashboard restart), `handleSessionChange` (in-process new/fork/resume), and any other path — the `spawnToken` field SHALL be omitted.

After reading the token on the first register, the bridge SHALL scrub it by deleting `process.env.PI_DASHBOARD_SPAWN_TOKEN` from its own process environment, so that any pi process the bridge's pi later spawns (subagent, nested `pi`, reload) does NOT inherit the single-use token. The token SHALL NOT be re-reported by any descendant process.

#### Scenario: First register includes the token then scrubs it
- **WHEN** a bridge process boots and `sendStateSync` runs for the first time
- **AND** `process.env.PI_DASHBOARD_SPAWN_TOKEN` is set to a non-empty string
- **THEN** the emitted `session_register` SHALL include `spawnToken` equal to the env-var value
- **AND** `bc.hasRegisteredOnce` SHALL be `true` after the call
- **AND** `process.env.PI_DASHBOARD_SPAWN_TOKEN` SHALL be unset (deleted) after the call

#### Scenario: Descendant pi does not inherit the token
- **WHEN** a dashboard-spawned pi (whose bridge has completed its first register) spawns a child pi process (subagent, nested `pi`, or reload)
- **THEN** the child's `process.env.PI_DASHBOARD_SPAWN_TOKEN` SHALL be absent
- **AND** the child's `session_register` SHALL NOT include a `spawnToken` field

#### Scenario: Reattach register omits the token
- **WHEN** the bridge reconnects after dashboard restart and `sendStateSync` runs again
- **THEN** the emitted `session_register` SHALL have `registerReason: "reattach"` and SHALL NOT include `spawnToken`

#### Scenario: In-process session change omits the token
- **WHEN** the user triggers Ctrl+F (fork), `/resume`, or `/new` inside the bridge's pi process and `handleSessionChange` runs
- **THEN** the emitted `session_register` for the new sessionId SHALL NOT include `spawnToken`

#### Scenario: Missing env-var produces no token field
- **WHEN** the bridge boots inside a pi process whose env does not contain `PI_DASHBOARD_SPAWN_TOKEN` (e.g. user-launched pi outside the dashboard, or a scrubbed descendant)
- **THEN** the emitted `session_register` SHALL NOT include a `spawnToken` field
- **AND** the protocol message SHALL still validate

## ADDED Requirements

### Requirement: `dashboardSpawned` derived from a capture-once boolean, not live token presence
The bridge SHALL determine `dashboardSpawned` by capturing `!!process.env.PI_DASHBOARD_SPAWN_TOKEN` ONCE, at process startup / first register, BEFORE the token is scrubbed. The bridge SHALL reuse that captured boolean for `dashboardSpawned` on every subsequent register. The bridge SHALL NOT re-read the env var for `dashboardSpawned` after scrubbing, because the token is single-use and intentionally removed.

This decouples the persistent "was I dashboard-spawned?" signal from the single-use token's lifetime, so scrubbing the token (to stop descendant/respawn leakage) does not regress `source: "dashboard"` labelling for the spawned process.

#### Scenario: dashboardSpawned stays true across registers after scrub
- **WHEN** a dashboard-spawned pi's bridge completes its first register (token read + scrubbed)
- **AND** the bridge later emits a second `session_register` (reattach or in-process change)
- **THEN** the second register SHALL carry `dashboardSpawned: true` (from the captured boolean)
- **AND** SHALL NOT carry a `spawnToken`

#### Scenario: Descendant child captures dashboardSpawned false
- **WHEN** a child pi is spawned by a dashboard-spawned pi after the token was scrubbed
- **THEN** the child captures `dashboardSpawned: false` at its own startup
- **AND** the server SHALL NOT stamp `source: "dashboard"` on the child from this signal

#### Scenario: Keeper respawn keeps dashboard source without re-emitting token
- **WHEN** the rpc-keeper respawns pi after a crash/restart
- **AND** the keeper has deleted `PI_DASHBOARD_SPAWN_TOKEN` from the respawn env but kept `PI_DASHBOARD_SPAWNED=1`
- **THEN** the respawned pi's `session_register` SHALL NOT include `spawnToken`
- **AND** the session SHALL retain `source: "dashboard"`

### Requirement: Keeper injects the spawn token into the first pi launch only
`keeper.cjs spawnPi()` SHALL include `PI_DASHBOARD_SPAWN_TOKEN` in the spawned pi's environment only for the FIRST pi launch of the keeper. For every subsequent respawn within the same keeper, `spawnPi()` SHALL delete `PI_DASHBOARD_SPAWN_TOKEN` from the child environment so the consumed single-use token is never re-reported. The keeper SHALL continue to strip `PI_KEEPER_PI_ARGS` and `PI_KEEPER_PI_CMD`, and SHALL continue to set `PI_DASHBOARD_SPAWNED=1` on every (re)spawn.

#### Scenario: First launch carries the token
- **WHEN** the keeper launches pi for the first time
- **THEN** the child env SHALL contain `PI_DASHBOARD_SPAWN_TOKEN` equal to the server-minted token
- **AND** SHALL contain `PI_DASHBOARD_SPAWNED=1`

#### Scenario: Respawn omits the token
- **WHEN** pi exits and the keeper respawns it
- **THEN** the respawn child env SHALL NOT contain `PI_DASHBOARD_SPAWN_TOKEN`
- **AND** SHALL still contain `PI_DASHBOARD_SPAWNED=1`
