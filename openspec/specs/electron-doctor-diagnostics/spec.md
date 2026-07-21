# electron-doctor-diagnostics Specification

## Purpose

Detect the CLI tools and runtimes a PI Dashboard installation depends on, run a full diagnostic Doctor report over those detections, and expose that report plus supporting log/clipboard/file-manager actions to a dedicated Doctor window through a typed IPC bridge. The report describes the current health of the runtime, pi tooling, server, tunnel, and setup, and never crashes the renderer regardless of internal failures.

## Requirements

### Requirement: CLI tool and runtime detection

The detector SHALL determine presence, resolved path, and source for the CLI tools and runtimes the dashboard depends on (`pi`, `openspec`, Node.js, the dashboard package, the bridge extension, and the `pi-dashboard` CLI). Detection reports only presence/path/source; installed version strings are read separately from the resolved package's `package.json` (via `getPkgVersion`), NOT by invoking the binary. Only `detectSystemNode()` invokes the resolved binary with `--version`, and it does so to enforce a usable-version floor rather than to report a version string.

#### Scenario: pi and openspec resolved through the tool registry

- **WHEN** `detectPi()` or `detectOpenSpec()` runs
- **THEN** the tool is resolved through the shared tool registry
- **AND** a result reporting `found`, `path`, and a `source` of `managed` (managed install) or `system` (any other resolved location) is returned
- **AND** a resolved path that is an AppImage self-hit is rejected as not found
- **AND** no `--version` is invoked; version reporting is left to the Doctor report layer, which reads `package.json`

#### Scenario: System Node enforces a usable version floor

- **WHEN** `detectSystemNode()` resolves a Node binary
- **THEN** the binary is invoked with `--version` and accepted only when the version is usable (within the engines range and not affected by the known bad Node range)
- **AND** when the resolved Node is unusable, well-known on-disk locations (`~/.nvm/versions/node/*/bin/node`, `/opt/homebrew/bin/node`, `/usr/local/bin/node`, `~/.volta/bin/node`, `/usr/bin/node`) are scanned for the highest-version usable Node
- **AND** when no usable Node is found the result reports `found: false`

#### Scenario: Tool not found

- **WHEN** a requested tool is not registered or the registry resolves nothing
- **THEN** the detection result reports `found: false` with no path

#### Scenario: Bridge extension resolved from pi settings first

- **WHEN** `detectBridgeExtension()` runs
- **THEN** `~/.pi/agent/settings.json` is parsed and its `packages[]` array is scanned for an entry whose string contains `pi-dashboard` or `pi-agent-dashboard`
- **AND** a match returns `found: true` with that entry as `path` and a `source` of `settings`
- **AND** when no settings entry matches (or settings are absent/corrupt) it falls back to `detectDashboardPackage()`

#### Scenario: pi-dashboard CLI self-detection filtered

- **WHEN** `detectPiDashboardCli()` resolves a candidate via `which`/`where`
- **THEN** `_npx` cache shim paths and AppImage self-hit paths are rejected as not found
- **AND** a managed-install binary under the managed bin directory is preferred when present

### Requirement: Managed path resolution

The system SHALL resolve managed-install locations from the user home directory and use them as the root for managed detection, log files, and file-manager actions.

#### Scenario: Managed directory anchors detection and logs

- **WHEN** managed paths are resolved
- **THEN** the managed directory is `~/.pi-dashboard`
- **AND** the managed bin directory is `~/.pi-dashboard/node_modules/.bin`
- **AND** the pi settings path is `~/.pi/agent/settings.json`

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
- **THEN** a `Dashboard server code` row (section `server`, Electron-only) checks for the bundled server CLI at `<resourcesPath>/server/packages/server/src/cli.ts`, falling back to `detectDashboardPackage()`, reporting `ok` with the resolved version/path (bundled version read from `<resourcesPath>/server/packages/server/package.json`, or the detected package's `package.json`) or `error` "Not found — required for the dashboard server" when neither resolves
- **AND** a `Server starter` row (section `server`) is emitted ONLY when the server is running, with its status taken from `probeServer().starter` — `ok` when a starter string is present, `warning` "Unknown (old server?)" when it is absent

#### Scenario: Report never rejects on internal failure

- **WHEN** report generation throws an unexpected internal error
- **THEN** `runDoctor()` returns a report containing a single `error` check named "Doctor failed to produce a report" with a summary of one error
- **AND** the `doctor:run` handler never rejects to the renderer

### Requirement: Per-check fault isolation and internal logging

The Doctor SHALL isolate each check so that a throw in one check produces a `diagnostics`-section error row instead of aborting the report, SHALL classify external-command failures into stable kinds, and SHALL append assumed-safe operation failures to a size-bounded internal log.

#### Scenario: A failing check becomes an error row

- **WHEN** an individual check function throws
- **THEN** the check is replaced by a `diagnostics`-section `error` row with a non-empty message, detail, and suggestion, and the report continues

#### Scenario: External command failure classified

- **WHEN** a check invokes an external command that fails
- **THEN** the failure is classified as `not-found`, `permission-denied`, `timeout`, `non-zero-exit`, or `unknown`, and the row carries that kind and a stderr tail

#### Scenario: Assumed-safe failure logged and rotated

- **WHEN** an assumed-safe operation throws
- **THEN** a JSON line is appended to `~/.pi-dashboard/doctor.log`
- **AND** the log is rotated to `doctor.log.1` when it exceeds its size cap
- **AND** logging failure never propagates into the report

### Requirement: Doctor window lifecycle

The system SHALL open a single Doctor window that hosts the report renderer, reusing and focusing the existing window instead of creating a duplicate, and SHALL recreate a fresh window after the previous one is closed.

#### Scenario: Reuse existing window

- **WHEN** the Doctor window is requested while an instance is already open
- **THEN** the existing window is restored if minimized and focused rather than recreated

#### Scenario: Fresh window after close

- **WHEN** the Doctor window is requested after the previous instance was closed
- **THEN** a new window is created with context isolation enabled and node integration disabled, loading the Doctor renderer HTML

### Requirement: Doctor IPC bridge contract

The Doctor window SHALL communicate with the main process only through the frozen set of IPC channels `doctor:run`, `doctor:open-log`, `doctor:open-doctor-log`, `doctor:copy`, and `doctor:open-managed-dir`, exposed to the renderer as `window.electron.doctor`. The four action handlers (`doctor:open-log`, `doctor:open-doctor-log`, `doctor:copy`, `doctor:open-managed-dir`) wrap their body in try/catch and reject with a structured `{ kind, message, detail }` object on failure. The `doctor:run` handler does NOT wrap its body; it relies on `runDoctor()` never throwing and instead adds concurrency serialization.

#### Scenario: Run request returns the report and serializes concurrency

- **WHEN** the renderer invokes `doctor:run`
- **THEN** the full Doctor report is returned
- **AND** a second `doctor:run` invocation arriving while the first is in flight awaits and receives the same in-flight report

#### Scenario: Open server log

- **WHEN** the renderer invokes `doctor:open-log`
- **THEN** `~/.pi-dashboard/server.log` is opened in the platform default viewer and `{ ok: true, path }` is returned, or `{ ok: false, path }` when the file does not exist

#### Scenario: Open doctor log

- **WHEN** the renderer invokes `doctor:open-doctor-log`
- **THEN** `~/.pi-dashboard/doctor.log` is opened and `{ ok: true, exists: true, path }` is returned, or `{ ok: true, exists: false }` when the file is absent

#### Scenario: Copy report text

- **WHEN** the renderer invokes `doctor:copy` with report text
- **THEN** the text is written to the system clipboard and `{ ok: true }` is returned

#### Scenario: Open managed directory

- **WHEN** the renderer invokes `doctor:open-managed-dir`
- **THEN** `~/.pi-dashboard` is opened in the OS file manager and `{ ok: true, path }` is returned

#### Scenario: Action handler failure surfaces a structured error

- **WHEN** one of the four action bridge handlers' body throws
- **THEN** the invocation rejects with an object carrying `kind`, `message`, and a truncated `detail` stack (via `asStructuredError`) rather than an unstructured error
- **AND** the `doctor:run` handler has no such wrapper because `runDoctor()` returns a fallback report instead of throwing
