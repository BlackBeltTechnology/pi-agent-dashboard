# first-run-wizard

## Purpose

Historical capability for the Electron first-run welcome wizard. Dissolved by change `auto-launch-first-run-skip-welcome` (launch is now unconditional; no wizard). Requirements below are superseded by that change's delta.
## Requirements
### Requirement: First-run marker is written on first successful launch
The Electron main process SHALL write `~/.pi/dashboard/first-run-done` (with a timestamp body) immediately after the `done` end state is reached for the first time on a given machine. The marker SHALL NOT be written on any intermediate state or on error end states.

The marker file is retained for backwards compatibility — external tooling (Doctor, support scripts, OS keychains) may use its presence as a signal that the user has successfully launched the dashboard at least once.

#### Scenario: Marker absent before first launch
- **WHEN** an Electron app launches on a machine where `~/.pi/dashboard/first-run-done` does not exist
- **THEN** the startup machine SHALL proceed through `check-health → launch-server → health-wait → done` without showing any welcome wizard
- **AND** SHALL NOT block on user input at any point

#### Scenario: Marker written after first success
- **WHEN** the startup machine reaches the `done` end state for the first time
- **THEN** `~/.pi/dashboard/first-run-done` SHALL be created with an ISO-8601 timestamp as its body
- **AND** the marker write SHALL be best-effort (failure to write SHALL log but SHALL NOT block the user)

#### Scenario: Marker not written on failure
- **WHEN** the startup machine ends in `loading-page-error` (spawn failed, deadline elapsed, or unhandled exception)
- **THEN** the marker SHALL NOT be written
- **AND** the next launch SHALL behave identically to a first-run launch (i.e. no fast-path)

#### Scenario: Subsequent launches unaffected
- **WHEN** an Electron app launches on a machine where `~/.pi/dashboard/first-run-done` already exists
- **THEN** the startup machine SHALL behave identically to a fresh launch (no fast-path, no slow-path — first-run-ness is no longer a state-machine branch)
- **AND** the marker SHALL NOT be re-written or modified

### Requirement: Remote-attach is reachable from Settings, not from a launch-time wizard
The "connect to a remote dashboard" workflow SHALL be reachable post-launch via Settings → Network → Known Servers (already implemented in `packages/client/src/components/KnownServersSection.tsx`). There SHALL NOT be a launch-time wizard offering remote-attach as a one-shot path.

#### Scenario: User wants to connect to a remote dashboard
- **WHEN** a user launches the Electron app for the first time AND wants to attach to a remote dashboard instead of the local one
- **THEN** the user SHALL allow the local dashboard to start normally (the splash runs through to `done`)
- **AND** SHALL navigate to Settings → Network → Known Servers
- **AND** SHALL configure the remote URL there

#### Scenario: Pre-configured remote via DASHBOARD_PREFER_SOURCE=attach
- **WHEN** the user pre-configures `DASHBOARD_PREFER_SOURCE=attach` (env var) AND a server is already running at the configured port
- **THEN** the startup machine SHALL take the `attach` arm of `selectLaunchSource` (already implemented) and SHALL NOT spawn a local server
- **AND** this env var continues to function as the power-user override (unchanged by this change)

