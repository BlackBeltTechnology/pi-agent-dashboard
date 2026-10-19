## MODIFIED Requirements

### Requirement: Spawned-server ownership tracking

The app SHALL track whether it started the reachable server this lifetime and SHALL only stop that server on quit when it owns it. The app SHALL read the server's launch source from the `launchSource` field that `/api/health` publishes (`"electron"`), falling back to the legacy `starter` field (`"Electron"`) only when `launchSource` is absent.

#### Scenario: Ownership is ours
- **WHEN** the reachable server reports `launchSourceEffective === "electron"` and its PID equals the PID this app spawned this lifetime
- **THEN** ownership is classified as electron

#### Scenario: Foreign or absent server
- **WHEN** the reachable server was not spawned by this app this lifetime, reports a non-electron effective launch source, or reports a mismatched PID
- **THEN** ownership is classified as foreign; and when the server is unreachable it is classified as none

#### Scenario: Stop only when owned on quit
- **WHEN** the app is quitting and the health-reported launch source is electron (`launchSource === "electron"`, or, when `launchSource` is absent, `starter === "Electron"`) and the health PID matches the stored spawned PID
- **THEN** the app requests server shutdown via `/api/shutdown`; otherwise it leaves the server running

#### Scenario: Quitting stops the app's own server on a current server
- **WHEN** the app is quitting, the server it spawned this lifetime answers `/api/health` with `launchSource: "electron"`, no `starter` field, and the stored spawned PID
- **THEN** the app requests server shutdown via `/api/shutdown`
- **AND** after the app exits, no dashboard server process it spawned remains alive

#### Scenario: Legacy starter field still honoured
- **WHEN** the app is quitting and the reachable server answers `/api/health` with `starter: "Electron"`, no `launchSource` field, and the stored spawned PID
- **THEN** the app requests server shutdown via `/api/shutdown`

#### Scenario: Graceful shutdown suppresses crash recovery
- **WHEN** the spawned server child exits while a graceful shutdown is in progress
- **THEN** the watchdog logs a graceful exit and does not route to the crash-recovery loading page; an exit outside a graceful shutdown routes to recovery

## ADDED Requirements

### Requirement: Electron health consumers read the published launch source

Every Electron main-process consumer that derives the server's starter from `/api/health` SHALL read the static `launchSource` field. It SHALL NOT read `launchSourceEffective`, whose `bridge-orphaned` value has no starter equivalent; the ownership classification above keeps using `launchSourceEffective` as today. The mapping is `"electron"` → Electron, `"bridge"` → Bridge, and `"standalone"` → Standalone. It SHALL fall back to the legacy `starter` string only when `launchSource` is absent. An unknown or missing value SHALL be treated exactly as an absent starter is treated today. This covers the quit-time shutdown decision, the update-strategy check, the Doctor starter row, and the attach probe of the launch-source resolver.

#### Scenario: Update strategy sees an Electron-started server
- **WHEN** `/api/health` reports `launchSource: "electron"` and no `starter`
- **THEN** the update-strategy check treats the server as Electron-started

#### Scenario: Doctor shows the starter of a current server
- **WHEN** the Doctor probes a server whose `/api/health` reports `launchSource: "standalone"` and no `starter`
- **THEN** the starter row reports Standalone with status ok, not "Unknown (old server?)"

#### Scenario: Attach probe records the real starter
- **WHEN** the launch-source resolver attaches to a running server whose `/api/health` reports `launchSource: "bridge"` and no `starter`
- **THEN** the attach result records the starter as Bridge, not the Standalone default

#### Scenario: Neither field present
- **WHEN** `/api/health` reports neither `launchSource` nor `starter`
- **THEN** each consumer behaves as it does today for a missing starter
