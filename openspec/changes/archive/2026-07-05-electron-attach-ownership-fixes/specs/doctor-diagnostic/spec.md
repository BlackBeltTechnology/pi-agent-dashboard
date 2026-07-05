# doctor-diagnostic — delta

## ADDED Requirements

### Requirement: Doctor reports attached-server version skew

The Doctor diagnostic SHALL include a check named "Attached server version" in the `setup` section that compares the running shell's application version against `/api/health.version` and emits a `warning` when they differ. The suggestion text SHALL be selected from `health.launchSource` to give the user a launch-source-appropriate fix path.

The check helper (`checkAttachedServerVersion`) lives in the shared doctor core (`packages/shared/src/doctor-core.ts`) but SHALL be wired into the Electron arm (`packages/electron/src/lib/doctor.ts`) ONLY. The server arm (`packages/server/src/routes/doctor-routes.ts`) SHALL NOT emit it: a server comparing its own package version to its own self-fetched `/api/health` is a loopback tautology (always `ok`, never detects skew). Version skew is only observable across the Electron-shell ↔ attached-server boundary.

- Status `ok` when `appVersion === health.version`.
- Status `warning` when the versions differ. Message format: `Dashboard server reports v<server>; this app bundle is v<app>`. Suggestion:
  - `launchSource === "standalone"` → `Run \`npm i -g @blackbelt-technology/pi-dashboard@<appVersion>\` and restart your terminal session.`
  - `launchSource === "bridge"` OR `launchSource === "bridge-orphaned"` → `Stop the pi session that started this server (or run \`pi-dashboard stop\`) and relaunch the app.`
  - `launchSource === "electron"` → `Quit the other Electron instance or use the zombie-adoption prompt to take ownership.`
- Status `error` when `/api/health` is unreachable or `health.version` is missing.

#### Scenario: Matching versions report OK

- **GIVEN** the Electron app version is `0.5.3` AND `/api/health.version` is `0.5.3`
- **WHEN** Doctor runs
- **THEN** the "Attached server version" row SHALL have status `ok`

#### Scenario: Mismatch with standalone server

- **GIVEN** the Electron app version is `0.5.3` AND `/api/health.version` is `0.5.1` AND `launchSource === "standalone"`
- **WHEN** Doctor runs
- **THEN** the row SHALL have status `warning`
- **AND** the suggestion SHALL contain `npm i -g @blackbelt-technology/pi-dashboard@0.5.3`

#### Scenario: Mismatch with bridge-started server

- **GIVEN** the Electron app version is `0.5.3` AND `/api/health.version` is `0.5.1` AND `launchSource === "bridge"`
- **WHEN** Doctor runs
- **THEN** the row SHALL have status `warning`
- **AND** the suggestion SHALL mention stopping the pi session OR running `pi-dashboard stop`

#### Scenario: Mismatch with other-Electron server

- **GIVEN** the Electron app version is `0.5.3` AND `/api/health.version` is `0.5.1` AND `launchSource === "electron"`
- **WHEN** Doctor runs
- **THEN** the row SHALL have status `warning`
- **AND** the suggestion SHALL mention quitting the other Electron instance or zombie-adoption

#### Scenario: Health unreachable produces error

- **GIVEN** the configured dashboard port responds with connection refused
- **WHEN** Doctor runs
- **THEN** the "Attached server version" row SHALL have status `error`
- **AND** the message SHALL indicate the server was unreachable

#### Scenario: Server-side Doctor omits the row

- **WHEN** the server-side Doctor route (`/api/doctor`) runs
- **THEN** the report SHALL NOT include an "Attached server version" row (the check is Electron-arm only; a server self-comparison is a loopback tautology)
