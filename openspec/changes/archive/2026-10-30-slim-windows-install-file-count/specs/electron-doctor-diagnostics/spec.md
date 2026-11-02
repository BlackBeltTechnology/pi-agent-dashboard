## MODIFIED Requirements

### Requirement: Doctor report generation

The Doctor SHALL run a fixed battery of checks covering the Electron shell, bundled Node and npm, the bundled Node runtime, shared runtime/pi-tooling/server/tunnel/setup checks, and Electron-only server checks, and SHALL return a report containing the ordered checks, a summary count of ok/warning/error statuses, and a generation timestamp.

#### Scenario: Full report with summary

- **WHEN** `runDoctor()` completes successfully
- **THEN** a report is returned with a `checks` array, a `summary` of `ok`, `warnings`, and `errors` counts derived from the check statuses, and a `generatedAt` timestamp
- **AND** each check carries a `name`, `status` of `ok`/`warning`/`error`, a `section`, and a `message`

#### Scenario: Electron and bundled runtime rows

- **WHEN** the report is generated
- **THEN** an `Electron` row reports the Electron and Chromium versions
- **AND** a `Bundled Node.js` row (section `runtime`) reports the bundled Node version obtained by invoking the bundled binary with `--version`, or an error/warning when the bundled binary is missing or fails its version probe
- **AND** a `Bundled npm` row (section `runtime`) reports the bundled npm version read from its `package.json`, or an error/warning when absent
- **AND** a `Bundled Node runtime` row (section `runtime`, from `checkManagedNodeRuntime()`) is emitted distinctly from `Bundled Node.js`, reporting `ok` with the bundled binary path, or `error` "Bundled Node binary not found" when the bundled Node binary is absent

#### Scenario: pi tooling split into library and PATH rows

- **WHEN** the shared checks run
- **THEN** separate `pi (library)` and `pi (CLI on PATH)` rows are emitted, and separate `openspec (library)` and `openspec (CLI on PATH)` rows are emitted
- **AND** the library rows reflect what the dashboard resolves internally while the PATH rows reflect what `which pi` / `which openspec` return from the user's shell
- **AND** a missing `pi (library)` is reported as an error and a missing `openspec (library)` or missing PATH entry is reported as a warning

#### Scenario: Server probe and attached-server version rows

- **WHEN** the report is generated
- **THEN** the dashboard server is probed at `http://localhost:8000/api/health` and a `Dashboard server` row reports running/not-running
- **AND** an `Attached server version` row compares the app bundle version against the health endpoint's reported version, reporting a warning on skew and an error when the server is unreachable or reports no version
- **AND** a `Server launch test` row runs only when the server is not already running

#### Scenario: Electron-only server-code and starter rows

- **WHEN** the report is generated
- **THEN** a `Dashboard server code` row (section `server`, Electron-only) checks for the bundled server CLI at `<resourcesPath>/server/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts`, falling back to `detectDashboardPackage()`, reporting `ok` with the resolved version/path (bundled version read from `<resourcesPath>/server/node_modules/@blackbelt-technology/pi-dashboard-server/package.json`, or the detected package's `package.json`) or `error` "Not found — required for the dashboard server" when neither resolves
- **AND** a `Server starter` row (section `server`) is emitted ONLY when the server is running, with its status taken from `probeServer().starter` — `ok` when a starter string is present, `warning` "Unknown (old server?)" when it is absent

#### Scenario: Report never rejects on internal failure

- **WHEN** report generation throws an unexpected internal error
- **THEN** `runDoctor()` returns a report containing a single `error` check named "Doctor failed to produce a report" with a summary of one error
- **AND** the `doctor:run` handler never rejects to the renderer
