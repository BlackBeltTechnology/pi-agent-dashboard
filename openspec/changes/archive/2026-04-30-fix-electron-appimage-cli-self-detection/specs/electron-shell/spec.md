# Delta: electron-shell

## ADDED Requirements

### Requirement: Power-user mode CLI launch path
In power-user mode the Electron app SHALL prefer launching the dashboard server through an already-installed `pi-dashboard` CLI on PATH, falling back to the standalone tsx + `cli.ts` path when no usable CLI is found. The CLI launch path mirrors `pi-dashboard start --port <port> --pi-port <piPort>` and reuses the same `~/.pi-dashboard/server.log` and 15-second `waitForReady` deadline as the tsx path.

#### Scenario: Power-user mode with managed CLI
- **GIVEN** `~/.pi-dashboard/mode.json` says `"mode": "power-user"`
- **AND** `~/.pi-dashboard/node_modules/.bin/pi-dashboard` exists
- **WHEN** `ensureServer()` runs
- **THEN** it SHALL spawn that managed CLI with `start --port <port> --pi-port <piPort>` and route stdout/stderr to `~/.pi-dashboard/server.log`

#### Scenario: Power-user mode with system CLI
- **GIVEN** `mode.json` says `"mode": "power-user"`
- **AND** no managed `pi-dashboard` binary exists
- **AND** `which pi-dashboard` resolves to a real CLI (e.g. an npm-global / nvm-managed install)
- **WHEN** `ensureServer()` runs
- **THEN** it SHALL spawn that system CLI with the same arguments as the managed case

#### Scenario: Power-user mode with no usable CLI falls through
- **GIVEN** `mode.json` says `"mode": "power-user"`
- **AND** no managed `pi-dashboard` binary exists
- **AND** `detectPiDashboardCli()` returns `{ found: false }` (e.g. only the AppImage's own binary was on PATH and it was rejected by the self-recursion guard)
- **WHEN** `ensureServer()` runs
- **THEN** it SHALL fall through to the standalone `launchServer()` path (tsx + `cli.ts`) without throwing

### Requirement: CLI launch rejects AppImage self-recursion
Electron binary-name detectors SHALL reject any candidate path that is the AppImage's own launcher executable when the app runs as a Linux AppImage. This prevents power-user mode from spawning the AppImage as if it were the `pi-dashboard` CLI — a recursion that produces a child process which never opens the dashboard port and causes `waitForReady` to time out, leaving the user on an indefinite loading screen.

A candidate path SHALL be considered self-recursive when any of the following is true:

- its realpath equals the realpath of `process.execPath`, OR
- it lives under the directory named by `process.env.APPDIR` (the AppImage squashfs mount), OR
- its realpath equals the realpath of `process.env.APPIMAGE` (the user-chosen `.AppImage` file).

The guard SHALL apply to every binary-name detector that participates in launching the dashboard server: at minimum `detectPiDashboardCli`, `detectPi`, and `detectSystemNode`.

#### Scenario: AppImage launcher named `pi-dashboard` is rejected
- **GIVEN** the Electron app is running as an AppImage with `executableName: "pi-dashboard"` and `APPDIR=/tmp/.mount_PI-Das…`
- **AND** `which pi-dashboard` returns `/tmp/.mount_PI-Das…/pi-dashboard` as its first hit
- **WHEN** `ensureServer()` enters the power-user CLI branch and calls `detectPiDashboardCli()`
- **THEN** the detector SHALL return `{ found: false }` for the AppImage path and SHALL continue searching subsequent PATH entries

#### Scenario: Real CLI later on PATH is preferred
- **GIVEN** the AppImage path is rejected as self-recursive
- **AND** a genuine `pi-dashboard` exists at `~/.nvm/versions/node/<ver>/bin/pi-dashboard`
- **WHEN** detection continues
- **THEN** `detectPiDashboardCli()` SHALL return the real CLI path with `source: "system"`

#### Scenario: Self-recursion guard applies to `pi` and `node` detectors
- **GIVEN** the AppImage exposes a binary named `pi` or `node` via its mount directory on PATH (hypothetical / future-proofing)
- **WHEN** `detectPi()` or `detectSystemNode()` runs
- **THEN** the AppImage-mount candidate SHALL be rejected on the same three conditions as `detectPiDashboardCli()`

#### Scenario: Probe failure produces a diagnostic error message
- **WHEN** `launchViaCli()` spawns a candidate that passes the guard but the spawned child still fails to open the dashboard port within the `waitForReady` deadline
- **THEN** the thrown error SHALL include the resolved candidate path AND a hint suggesting the user verify it with `readlink -f $(which pi-dashboard)` so the failure is recognizable as either a real CLI bug or a slipped-through self-recursion case
