# dashboard-starter-identity

## Purpose

Defines a runtime identity (`DASHBOARD_STARTER`) that every dashboard server process inherits from its spawner, so downstream consumers (update checker, lifecycle owner, reinstall endpoint) can derive behaviour from "who started the server" without consulting persisted mode flags.
## Requirements
### Requirement: DASHBOARD_STARTER env var contract

Every spawn site that produces a dashboard server process SHALL set `DASHBOARD_STARTER` on the spawned process env to one of `"Bridge"`, `"Standalone"`, or `"Electron"`. The server SHALL read this variable once at boot, validate against the enum, default to `"Standalone"` when unset, and persist the value in `bootstrap-state` for the lifetime of the process.

#### Scenario: Bridge auto-start sets starter

- **WHEN** `packages/extension/src/server-launcher.ts:launchServer` spawns the dashboard server
- **THEN** the spawn options env SHALL include `DASHBOARD_STARTER: "Bridge"`

#### Scenario: Electron launch sets starter

- **WHEN** `packages/electron/src/lib/launch-source.ts:spawnFromSource` spawns the dashboard server for any non-`attach` source kind
- **THEN** the spawn options env SHALL include `DASHBOARD_STARTER: "Electron"`

#### Scenario: Direct CLI invocation defaults to Standalone

- **WHEN** the user invokes `pi-dashboard start` from a terminal with no explicit `DASHBOARD_STARTER` env set
- **THEN** the server SHALL default the starter value to `"Standalone"`

#### Scenario: Invalid starter value rejected

- **WHEN** the server boots AND `DASHBOARD_STARTER` is set to a value outside the enum
- **THEN** the server SHALL log a warning AND default the starter to `"Standalone"`

### Requirement: Starter exposed via /api/health

The HTTP health endpoint SHALL expose the running server's starter value alongside the existing health fields, enabling clients to determine lifecycle ownership without reading process env.

#### Scenario: /api/health includes starter

- **WHEN** a client requests `GET /api/health`
- **THEN** the response body SHALL include `starter` field set to the server's `DashboardStarter` value
- **AND** the response SHALL include the existing `version`, `mode`, and `pid` fields

### Requirement: Lifecycle ownership rule

The Electron app SHALL stop the dashboard server on quit if and only if the running server's starter is `"Electron"` AND the running server's pid matches the pid Electron spawned during this Electron process lifetime.

#### Scenario: Electron quit stops own server

- **WHEN** Electron quits AND the running server's `health.starter === "Electron"` AND `health.pid === storedSpawnedPid`
- **THEN** Electron SHALL send the server a graceful shutdown signal
- **AND** SHALL await server exit before terminating its own process

#### Scenario: Electron quit leaves Bridge-started server

- **WHEN** Electron quits AND the running server's `health.starter === "Bridge"`
- **THEN** Electron SHALL NOT send any shutdown signal to the server
- **AND** SHALL terminate its own process leaving the server running

#### Scenario: Electron quit leaves Standalone-started server

- **WHEN** Electron quits AND the running server's `health.starter === "Standalone"`
- **THEN** Electron SHALL NOT send any shutdown signal to the server
- **AND** SHALL terminate its own process leaving the server running

#### Scenario: Electron quit leaves other-Electron-started server

- **WHEN** Electron quits AND the running server's `health.starter === "Electron"` AND `health.pid !== storedSpawnedPid`
- **THEN** Electron SHALL NOT send any shutdown signal to the server
- **AND** SHALL terminate its own process leaving the server running

### Requirement: Update strategy derived from starter

The Electron update checker SHALL select its update strategy from `health.starter` rather than from any persisted mode flag. The mapping SHALL be `Electron → in-app updater`, `Standalone → npm update -g recommendation`, `Bridge → defer to pi version bump`.

#### Scenario: Electron starter uses in-app updater

- **WHEN** the update checker runs AND `health.starter === "Electron"`
- **THEN** the checker SHALL invoke the existing in-app updater path

#### Scenario: Standalone starter recommends npm update

- **WHEN** the update checker runs AND `health.starter === "Standalone"`
- **THEN** the checker SHALL surface a notification recommending `npm update -g @blackbelt-technology/pi-agent-dashboard`
- **AND** SHALL NOT invoke the in-app updater

#### Scenario: Bridge starter defers to pi

- **WHEN** the update checker runs AND `health.starter === "Bridge"`
- **THEN** the checker SHALL surface a notification stating the dashboard is bundled with pi
- **AND** SHALL NOT invoke any update mechanism

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

