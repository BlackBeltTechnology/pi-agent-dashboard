## MODIFIED Requirements

### Requirement: Bridge reads `PI_DASHBOARD_SPAWN_TOKEN` and includes it on first register only
The bridge extension SHALL read `process.env.PI_DASHBOARD_SPAWN_TOKEN` exactly once per pi process, at the first bridge activation in that process (identified by the absence of persisted bridge state from an earlier activation; a `/reload` re-activation does not re-read). In that read it SHALL, in this order: (1) capture the `dashboardSpawned` boolean as defined by the requirement "`dashboardSpawned` derived from a capture-once boolean, not live token presence" (an empty string counts as absent); (2) keep a non-empty token value in the bridge state that persists across `/reload` re-activations; (3) delete `process.env.PI_DASHBOARD_SPAWN_TOKEN` from its own process environment. This happens before `project_trust`, before any register, and whether or not the bridge ever reaches the dashboard, so that any pi process the bridge's pi later spawns (subagent, nested `pi`, reload) does NOT inherit the single-use token, even while the dashboard is unreachable.

Every register path (state sync and the `session_start` register alike) SHALL obtain the token through one consume-once operation on the kept value: the first register to call it receives the token and clears the kept value; every later call, on any path and after any `/reload`, receives nothing. The bridge SHALL include `spawnToken` in `session_register` only when that operation returned a token. For all other registers — including reattach (after dashboard restart), `handleSessionChange` (in-process new/fork/resume), and any other path — the `spawnToken` field SHALL be omitted. The token SHALL NOT be re-reported by any descendant process. The parent-side half of this guarantee — the keeper never re-injecting a consumed token — is the requirement "Keeper injects the spawn token into the first pi launch only".

#### Scenario: First register includes the token then scrubs it
- **WHEN** a bridge process boots with `process.env.PI_DASHBOARD_SPAWN_TOKEN` set to a non-empty string and `sendStateSync` runs for the first time
- **THEN** the emitted `session_register` SHALL include `spawnToken` equal to the env-var value read at activation
- **AND** `bc.hasRegisteredOnce` SHALL be `true` after the call
- **AND** `process.env.PI_DASHBOARD_SPAWN_TOKEN` SHALL already be unset (deleted) when the call runs

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

#### Scenario: Token is scrubbed at activation even without a dashboard
- **WHEN** a dashboard-spawned pi's bridge activates while the dashboard is unreachable, so no register happens
- **AND** the agent then starts a nested `pi --mode rpc`
- **THEN** `process.env.PI_DASHBOARD_SPAWN_TOKEN` SHALL already be unset in the parent after activation
- **AND** the nested pi SHALL capture `dashboardSpawned: false`

#### Scenario: Capture happens before the scrub
- **WHEN** a bridge activates with `PI_DASHBOARD_SPAWN_TOKEN=t1`
- **THEN** the captured `dashboardSpawned` SHALL be `true` and the environment variable SHALL be unset afterwards

#### Scenario: Two register paths consume the token once
- **WHEN** the `session_start` register and the first state sync both run after activation with a kept token `t1`
- **THEN** exactly one emitted `session_register` SHALL carry `spawnToken: "t1"` and the other SHALL omit it

#### Scenario: Reload before the first register keeps the token
- **WHEN** `/reload` re-activates the bridge after the activation scrub but before any register
- **THEN** the next first register SHALL still carry the kept token, and `dashboardSpawned` SHALL stay `true`

#### Scenario: Empty token is absent
- **WHEN** a bridge activates with `PI_DASHBOARD_SPAWN_TOKEN` set to an empty string
- **THEN** `dashboardSpawned` SHALL be `false`, nothing SHALL be kept, and no register SHALL carry `spawnToken`
