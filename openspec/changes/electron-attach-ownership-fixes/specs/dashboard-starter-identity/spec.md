# dashboard-starter-identity — delta

## ADDED Requirements

### Requirement: /api/health exposes parent PID and active bridge count

The HTTP health endpoint SHALL include two additional fields beyond the existing `starter`/`launchSource`, `version`, `mode`, and `pid`:

- `ppid: number` — the parent PID of the server process at boot time. Cached at module load (since `process.ppid` is stable for the process lifetime).
- `activeBridgeCount: number` — the count of pi WebSocket connections currently held by the pi-gateway. Re-evaluated per health request.

These fields enable downstream consumers (Electron zombie detection, bridge-orphan classification, Doctor diagnostics) to make ownership decisions without out-of-band probes.

#### Scenario: /api/health includes ppid

- **WHEN** a client requests `GET /api/health`
- **THEN** the response body SHALL include `ppid` set to the server's parent PID at boot

#### Scenario: /api/health includes active bridge count

- **WHEN** a client requests `GET /api/health` AND zero pi bridges are connected
- **THEN** the response body SHALL include `activeBridgeCount: 0`

#### Scenario: Active bridge count reflects current connections

- **WHEN** a pi bridge is connected to the pi-gateway AND a client requests `GET /api/health`
- **THEN** the response SHALL include `activeBridgeCount` ≥ 1

### Requirement: /api/health exposes effective launch source

The HTTP health endpoint SHALL include a `launchSourceEffective: "electron" | "standalone" | "bridge" | "bridge-orphaned"` field alongside the existing static `launchSource` field. The effective value SHALL be derived per-request by a pure helper from `(rawLaunchSource, activeBridgeCount, uptimeMs)` using the rule:

- If `rawLaunchSource === "bridge"` AND `activeBridgeCount === 0` AND `uptimeMs > 30_000` → `"bridge-orphaned"`
- Otherwise → `rawLaunchSource` (cast to the wider union)

The 30 second uptime grace window absorbs the bootstrap race where a bridge-spawned server completes startup before the bridge reconnects after a `server_restarting` broadcast.

The static `launchSource` field SHALL retain its current closed union (`"electron" | "standalone" | "bridge"`) and SHALL NOT change values during the server's lifetime — back-compat is preserved for the `decideShutdownOnQuit` invariant.

#### Scenario: Bridge with no connections after grace window

- **GIVEN** the server was spawned with `DASHBOARD_STARTER=Bridge`
- **WHEN** the server has been running 31 seconds AND zero pi bridges are connected AND a client requests `GET /api/health`
- **THEN** the response SHALL include `launchSource: "bridge"`
- **AND** `launchSourceEffective: "bridge-orphaned"`

#### Scenario: Bridge with no connections inside grace window

- **GIVEN** the server was spawned with `DASHBOARD_STARTER=Bridge`
- **WHEN** the server has been running 5 seconds AND zero pi bridges are connected
- **THEN** the response SHALL include `launchSourceEffective: "bridge"`

#### Scenario: Bridge with a live connection

- **GIVEN** the server was spawned with `DASHBOARD_STARTER=Bridge`
- **WHEN** at least one pi bridge is connected
- **THEN** the response SHALL include `launchSourceEffective: "bridge"`

#### Scenario: Electron launch source never promoted

- **GIVEN** the server was spawned with `DASHBOARD_STARTER=Electron`
- **WHEN** any health request is served
- **THEN** the response SHALL include `launchSourceEffective: "electron"` regardless of bridge count or uptime

#### Scenario: Standalone launch source never promoted

- **GIVEN** the server was spawned with no `DASHBOARD_STARTER` env (defaults to Standalone)
- **WHEN** any health request is served
- **THEN** the response SHALL include `launchSourceEffective: "standalone"` regardless of bridge count or uptime
