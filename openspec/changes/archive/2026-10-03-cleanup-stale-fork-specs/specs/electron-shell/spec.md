## ADDED Requirements

### Requirement: `shouldUrlWrapEntry()` documents the jiti URL-entry breakage
The header comment of `shouldUrlWrapEntry()` in `packages/shared/src/platform/node-spawn.ts` SHALL carry a "JITI VERSION CONTRACT" section. The section SHALL explain why the entry-wrap rule passes jiti entries raw. The rule itself is owned by `server-launch` "Single shared dashboard-server spawn primitive". The section SHALL:
- document the Windows breakage, either with the `file:/<cwd>/file:/…` error signature or by naming it misnormalisation;
- give remediation guidance for a future jiti that fixes URL handling: re-verify on real Windows and add a per-version branch.

The rule SHALL NOT branch on, or assert, a specific `pi-coding-agent` or jiti version. The comment may name versions as historical evidence.

#### Scenario: Header comment documents the contract
- **WHEN** `packages/shared/src/platform/node-spawn.ts` is read
- **THEN** it SHALL contain the string "JITI VERSION CONTRACT"
- **AND** it SHALL contain a Windows-breakage marker: the `file:/…file:/` error signature or the word "misnormalise"/"misnormalize"
- **AND** it SHALL contain remediation guidance: "re-verify" or "per-version branch"

#### Scenario: Contract is regression-pinned without a version pin
- **WHEN** `node-spawn-jiti-contract.test.ts` runs
- **THEN** it SHALL assert the header-comment markers above and the jiti arm of the `server-launch` entry-wrap rule
- **AND** it SHALL NOT read `packages/electron/offline-packages.json` or assert any `pi-coding-agent` version range

## MODIFIED Requirements

### Requirement: Electron main process lifecycle

The Electron main process SHALL discover or launch a dashboard server, then open a BrowserWindow pointing at the server URL. The server SHALL always run as a separate detached process, never in-process. On `ensureServer()` failure the main process SHALL classify the error and route to either the configuration-error dialog or the interactive loading page — it SHALL NOT retry `ensureServer()` a second time, because a second 15 s budget produces no useful signal that the loading page (which polls indefinitely) does not already provide.

#### Scenario: Launch with no server running

- **WHEN** the Electron app starts and no dashboard server is discovered (mDNS via `@blackbelt-technology/pi-dashboard-shared/mdns-discovery` + health check fallback via `@blackbelt-technology/pi-dashboard-shared/server-identity`)
- **THEN** it SHALL launch the server as a detached process through `launchDashboardServer` (see `server-launch`), with the jiti loader from the resolved launch source, and open a BrowserWindow pointing at `http://localhost:<port>` once the server is ready

#### Scenario: Launch with server already running

- **WHEN** the Electron app starts and a localhost dashboard server is discovered
- **THEN** it SHALL skip server launch and open a BrowserWindow pointing at the discovered server URL

#### Scenario: Window close behavior

- **WHEN** the user closes the Electron window
- **THEN** the app SHALL minimize to the system tray (server keeps running)

#### Scenario: Configuration-error failure shows error dialog

- **GIVEN** `ensureServer()` throws an error that does NOT begin with "Server did not respond within" or "Server child process exited prematurely" (e.g. "No TypeScript loader found", "Dashboard server CLI not found", "Port N is in use by another service")
- **WHEN** the main process catches the error
- **THEN** it SHALL close the splash and show an error dialog with the failure reason and offer "Run Setup", "Retry", or "Quit" options
- **AND** it SHALL NOT issue a second `ensureServer()` attempt before showing the dialog

#### Scenario: Deadline / child-exit failure falls through to loading page

- **GIVEN** `ensureServer()` throws an error whose message begins with "Server did not respond within" OR "Server child process exited prematurely"
- **WHEN** the main process catches the error
- **THEN** it SHALL close the splash, open the BrowserWindow at `http://localhost:<port>`, and call `showLoadingPage(win, serverUrl)`
- **AND** it SHALL NOT show the error dialog
- **AND** it SHALL NOT issue a second `ensureServer()` attempt
- **AND** the loading page SHALL keep polling `/api/health` every 1.5 s, surfacing Start server / Open Doctor / server-log controls after ~15 s as already specified

### Requirement: Doctor diagnostic function
The app SHALL provide a Doctor function accessible from the app menu that checks all required components and renders the result in a dedicated styled BrowserWindow (not a native message-box dialog).

#### Scenario: Doctor checks all components
- **WHEN** the user opens "Doctor..." from the menu
- **THEN** it SHALL check: Electron version, system Node.js, bundled Node.js, bundled npm, pi CLI, openspec CLI, dashboard server code, TypeScript loader, dashboard server status, server log presence, server launch test, setup wizard state, API key configuration, and managed install directory
- **AND** each check SHALL report status (ok/warning/error), version, path, the section it belongs to, and a remediation suggestion when the status is not ok

#### Scenario: Doctor opens a styled window
- **WHEN** the user opens "Doctor..." from the menu
- **THEN** the app SHALL open a dedicated BrowserWindow rendering the report grouped by section, with a per-row status pill, message, optional path, and optional suggestion
- **AND** the window SHALL provide toolbar actions: Re-run, Copy as Markdown, Copy as Plain text, Open server log, Open doctor log, Run setup wizard
- **AND** opening Doctor while the window is already open SHALL focus the existing window instead of creating a second one

#### Scenario: Doctor offers setup for errors
- **WHEN** the Doctor report contains fixable errors
- **THEN** the window SHALL surface a "Run setup wizard" toolbar action that triggers the setup wizard

## REMOVED Requirements

### Requirement: Server launch via tsx binary
**Reason**: The launcher no longer spawns the `tsx` binary from the managed dir, and `resolveJitiFromPi()` was deleted. The server now launches through `launchDashboardServer` with a resolved jiti loader from the bundled or overlay runtime. The jiti fallback scenario named the legacy `@mariozechner/pi-coding-agent` fork.
**Migration**: None. See change `eliminate-electron-runtime-install`. Launch is specified by the `server-launch` capability.

### Requirement: Power-user mode runs `installStandalone()` even when the wizard UI is skipped
**Reason**: `installStandalone()` and the managed-dir dependency install were deleted, so no first-launch install runs in any wizard mode. The power-user wizard mode still exists, but it only chooses the UI. The requirement pinned `@mariozechner/pi-coding-agent` in the managed dir.
**Migration**: None. See change `eliminate-electron-runtime-install`.

### Requirement: Extracted LaunchSource health-checks jiti reachability before returning
**Reason**: The `extracted` LaunchSource kind, `extractLaunchSource`, `extractedSourceIsHealthy` and the extract-then-`installStandalone` block were deleted. Launch sources are now `devMonorepo`, `bundled`, `overlay`, `localLink` and `attach`.
**Migration**: None. See change `eliminate-electron-runtime-install`.

### Requirement: `shouldUrlWrapEntry()` documents jiti version contract
**Reason**: It pinned the contract to `@mariozechner/pi-coding-agent@0.70.x` through `offline-packages.json` and `installStandalone()`, all deleted by `eliminate-electron-runtime-install`. The live contract has no version pin and passes jiti entries raw on every platform.
**Migration**: Replaced by "`shouldUrlWrapEntry()` documents the jiti URL-entry breakage" (ADDED above). The raw-entry behaviour is owned by `server-launch` "Single shared dashboard-server spawn primitive".
