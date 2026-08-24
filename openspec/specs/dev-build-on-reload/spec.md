# dev-build-on-reload Specification

## Purpose

Makes the reload action rebuild before restarting when running in development mode, so a reload reflects the working tree instead of the last built artifact.

## Requirements

### Requirement: Dev build and restart on reload
When `devBuildOnReload` is `true` in the dashboard config, the bridge extension's cleanup hook (triggered by `/reload`) SHALL synchronously build the Vite client and request the dashboard server to shut down before the reload completes. Progress SHALL be logged to the terminal.

The build step SHALL run `npm run build` via `execSync` in the package root directory (resolved from the extension's `__dirname`). On build failure, the error SHALL be logged but the reload SHALL continue.

The shutdown step SHALL send `POST /api/shutdown` to `http://localhost:{port}` using the configured HTTP port. The request SHALL be fire-and-forget — failures are logged but do not block the reload.

After reload completes, the existing `autoStart` mechanism SHALL spawn a fresh server instance.

#### Scenario: Reload with devBuildOnReload enabled
- **WHEN** `/reload` is triggered and `devBuildOnReload` is `true`
- **THEN** the cleanup hook SHALL log `🔨 Dashboard: building client...`, run `npm run build`, log `✅ Dashboard: client built`, log `🛑 Dashboard: stopping server...`, send `POST /api/shutdown`, and log `✅ Dashboard: server stopped`

#### Scenario: Reload with devBuildOnReload disabled
- **WHEN** `/reload` is triggered and `devBuildOnReload` is `false` (default)
- **THEN** the cleanup hook SHALL NOT build the client or shut down the server

#### Scenario: Build failure during reload
- **WHEN** `/reload` is triggered with `devBuildOnReload` enabled but `npm run build` fails
- **THEN** the cleanup hook SHALL log the error and continue with the server shutdown and reload

#### Scenario: Server not running during reload
- **WHEN** `/reload` is triggered with `devBuildOnReload` enabled but the server is not running
- **THEN** the shutdown fetch SHALL fail silently and the reload SHALL complete normally

#### Scenario: Fresh server after reload
- **WHEN** the bridge re-initializes after a dev-build reload
- **THEN** `autoStart` SHALL detect the server is not running and spawn a fresh instance with the newly built client
