# Delta: dependency-installer

## ADDED Requirements

### Requirement: Detect pi-dashboard CLI binary
The dependency installer SHALL provide `detectPiDashboardCli()` that resolves the `pi-dashboard` binary, checking the managed install location first, then system PATH, with safety filters against npx-cache hits and AppImage self-recursion.

#### Scenario: Managed install preferred
- **WHEN** `detectPiDashboardCli()` is called and `~/.pi-dashboard/node_modules/.bin/pi-dashboard` exists
- **THEN** it SHALL return `{ found: true, path: "<managed-path>", source: "managed" }`

#### Scenario: System PATH fallback
- **WHEN** no managed binary exists
- **AND** `which pi-dashboard` (or `where pi-dashboard` on Windows) resolves to a non-rejected path
- **THEN** it SHALL return `{ found: true, path: "<system-path>", source: "system" }`

#### Scenario: npx cache hits are rejected
- **WHEN** the resolved path contains `.npm/_npx` or `.npm\_npx`
- **THEN** the detector SHALL skip it and return `{ found: false }`

#### Scenario: AppImage self-hits are rejected
- **WHEN** the Electron app is running as a Linux AppImage and the resolved path is the AppImage's own launcher executable (realpath equals `process.execPath`, or is under `process.env.APPDIR`, or equals `process.env.APPIMAGE`)
- **THEN** the detector SHALL skip it and return `{ found: false }` so callers fall through to `launchServer()` (tsx + `cli.ts`)

#### Scenario: No CLI anywhere
- **WHEN** no candidate survives the filters
- **THEN** it SHALL return `{ found: false }`

### Requirement: AppImage self-recursion guard for binary-name detectors
The detectors `detectPi`, `detectOpenSpec`, `detectSystemNode`, and `detectPiDashboardCli` SHALL reject any candidate whose realpath equals `process.execPath`, sits under `process.env.APPDIR`, or equals `process.env.APPIMAGE`. This prevents a binary that lives next to the Electron launcher inside an AppImage's squashfs mount from being mistaken for an external tool.

#### Scenario: detectPi rejects an AppImage-mount hit
- **GIVEN** `process.env.APPDIR` is set
- **AND** the registry resolves `pi` to a path under `APPDIR`
- **WHEN** `detectPi()` is called
- **THEN** it SHALL return `{ found: false }`

#### Scenario: detectSystemNode rejects an AppImage-mount hit
- **GIVEN** `process.env.APPDIR` is set
- **AND** the registry resolves `node` to a path under `APPDIR`
- **WHEN** `detectSystemNode()` is called
- **THEN** it SHALL return `{ found: false }` regardless of the candidate's reported version
