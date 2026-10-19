## MODIFIED Requirements

### Requirement: Starter exposed via /api/health

The HTTP health endpoint SHALL expose the running server's starter alongside the existing health fields as the lowercase `launchSource` field (`"electron" | "standalone" | "bridge"`, mapped from `DashboardStarter` `Electron | Standalone | Bridge`). This lets clients determine lifecycle ownership without reading process env. The legacy `starter` field is no longer published on `/api/health`. Other endpoints that carry their own `starter` value (e.g. the `/api/doctor` probe payload) are out of this requirement's scope. Clients SHALL read `launchSource`. A client SHALL use a `starter` string only when `launchSource` is absent, which happens only with servers that predate the removal.

#### Scenario: /api/health includes starter

- **WHEN** a client requests `GET /api/health`
- **THEN** the response body SHALL include a `launchSource` field set to the lowercase form of the server's `DashboardStarter` value
- **AND** the response SHALL include the existing `version`, `mode`, and `pid` fields

#### Scenario: Legacy starter field is absent

- **WHEN** a client requests `GET /api/health` from a server spawned with `DASHBOARD_STARTER=Electron`
- **THEN** the response body SHALL include `launchSource: "electron"`
- **AND** it SHALL NOT include a `starter` field

### Requirement: Lifecycle ownership rule

The Electron app SHALL stop the dashboard server on quit if and only if the running server's launch source is electron AND the running server's pid matches the pid Electron spawned during this Electron process lifetime. The launch source is `health.launchSource`; only when that field is absent does the app use a legacy `health.starter` value (`"Electron"` ≙ `"electron"`).

#### Scenario: Electron quit stops own server

- **WHEN** Electron quits AND the running server's `health.launchSource === "electron"` AND `health.pid === storedSpawnedPid`
- **THEN** Electron SHALL send the server a graceful shutdown signal
- **AND** SHALL await server exit, polling for at most 5 seconds, before terminating its own process

#### Scenario: Electron quit stops own legacy server

- **WHEN** Electron quits AND the running server reports no `launchSource` but `health.starter === "Electron"` AND `health.pid === storedSpawnedPid`
- **THEN** Electron SHALL send the server a graceful shutdown signal

#### Scenario: Electron quit leaves Bridge-started server

- **WHEN** Electron quits AND the running server's `health.launchSource === "bridge"`
- **THEN** Electron SHALL NOT send any shutdown signal to the server
- **AND** SHALL terminate its own process leaving the server running

#### Scenario: Electron quit leaves Standalone-started server

- **WHEN** Electron quits AND the running server's `health.launchSource === "standalone"`
- **THEN** Electron SHALL NOT send any shutdown signal to the server
- **AND** SHALL terminate its own process leaving the server running

#### Scenario: Electron quit leaves other-Electron-started server

- **WHEN** Electron quits AND the running server's `health.launchSource === "electron"` AND `health.pid !== storedSpawnedPid`
- **THEN** Electron SHALL NOT send any shutdown signal to the server
- **AND** SHALL terminate its own process leaving the server running

### Requirement: Update strategy derived from starter

The Electron update checker SHALL select its update strategy from the server's launch source (`health.launchSource`, falling back to a legacy `health.starter` only when `launchSource` is absent) rather than from any persisted mode flag. The mapping SHALL be `electron → in-app updater`, `standalone → npm update -g recommendation`, `bridge → defer to pi version bump`.

#### Scenario: Electron starter uses in-app updater

- **WHEN** the update checker runs AND `health.launchSource === "electron"`
- **THEN** the checker SHALL invoke the existing in-app updater path

#### Scenario: Standalone starter recommends npm update

- **WHEN** the update checker runs AND `health.launchSource === "standalone"`
- **THEN** the checker SHALL surface a notification recommending `npm update -g @blackbelt-technology/pi-agent-dashboard`
- **AND** SHALL NOT invoke the in-app updater

#### Scenario: Bridge starter defers to pi

- **WHEN** the update checker runs AND `health.launchSource === "bridge"`
- **THEN** the checker SHALL surface a notification stating the dashboard is bundled with pi
- **AND** SHALL NOT invoke any update mechanism

#### Scenario: Legacy server reports only starter

- **WHEN** the update checker runs AND the server reports no `launchSource` but `health.starter === "Standalone"`
- **THEN** the checker SHALL use the standalone strategy

### Requirement: /api/health exposes boot parent PID, live parent PID, and active bridge count

The HTTP health endpoint SHALL include additional fields beyond the existing `launchSource`, `version`, `mode`, and `pid`:

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
