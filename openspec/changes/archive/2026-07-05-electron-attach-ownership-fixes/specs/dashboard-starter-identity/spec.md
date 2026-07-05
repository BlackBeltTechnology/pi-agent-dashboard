# dashboard-starter-identity — delta

## ADDED Requirements

### Requirement: /api/health exposes boot parent PID, live parent PID, and active bridge count

The HTTP health endpoint SHALL include additional fields beyond the existing `starter`/`launchSource`, `version`, `mode`, and `pid`:

- `bootParentPid: number` — the parent PID captured ONCE at server boot (module-load const). Static by design; the parent the server was spawned under.
- `ppid: number` — the server's **live** parent PID, read fresh per request. On POSIX it is read via a syscall (Linux `/proc/self/stat` field 4; macOS `ps -o ppid=`) and SHALL NOT be `process.ppid` (Node caches that getter on first access, so it would not reflect reparenting). On `win32` the field is populated from `process.ppid` — Windows never reparents an orphan, so the cached getter is correct there and zombie detection relies on `bootParentAlive` (not `ppid`) on that platform. The platform branch (not the value) is cached.
- `bootParentAlive: boolean` — whether `bootParentPid` is still the same live process it was at boot. Computed server-side with a two-tier check: Tier 1 (`isProcessAlive(bootParentPid)`, all platforms, PID-reuse-vulnerable) and, on `win32`, an optional Tier 2 identity-safe upgrade holding a `SYNCHRONIZE` process handle (`OpenProcess` + `WaitForSingleObject`, via `koffi`) that is immune to PID reuse. Tier 2 degrades to Tier 1 when `koffi`/`OpenProcess` is unavailable; the field SHALL always be present and SHALL NOT throw.
- `activeBridgeCount: number` — the count of pi WebSocket connections currently held by the pi-gateway, via the existing `connectionCount()` getter. Re-evaluated per health request.

These fields enable downstream consumers (Electron zombie detection, bridge-orphan classification, Doctor diagnostics) to make ownership decisions without out-of-band probes. Zombie detection compares live `ppid` against `bootParentPid` plus a liveness check — not `ppid === 1`, which is unreliable under Linux subreapers and containers.

#### Scenario: /api/health includes boot and live parent PIDs and liveness

- **WHEN** a client requests `GET /api/health`
- **THEN** the response body SHALL include `bootParentPid` (captured at boot), `ppid` (read live per request), AND `bootParentAlive` (a boolean)

#### Scenario: bootParentAlive degrades gracefully without native FFI

- **GIVEN** the server runs on a platform/arch where `koffi` (Tier 2) cannot load
- **WHEN** a client requests `GET /api/health`
- **THEN** `bootParentAlive` SHALL still be present as a boolean, computed via the Tier 1 `isProcessAlive` path, without throwing

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
