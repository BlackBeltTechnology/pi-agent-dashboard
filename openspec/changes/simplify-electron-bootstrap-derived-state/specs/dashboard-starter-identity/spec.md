## ADDED Requirements

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
