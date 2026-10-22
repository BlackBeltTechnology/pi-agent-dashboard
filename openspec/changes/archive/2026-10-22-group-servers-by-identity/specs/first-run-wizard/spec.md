## MODIFIED Requirements

### Requirement: Remote-attach is reachable from Settings, not from a launch-time wizard
The "connect to a remote dashboard" workflow SHALL be reachable post-launch via Settings → Network → Servers (the merged server list, formerly "Known Servers"; implemented in `packages/client/src/components/connectivity/KnownServersSection.tsx`). There SHALL NOT be a launch-time wizard offering remote-attach as a one-shot path.

#### Scenario: User wants to connect to a remote dashboard
- **WHEN** a user launches the Electron app for the first time AND wants to attach to a remote dashboard instead of the local one
- **THEN** the user SHALL allow the local dashboard to start normally (the splash runs through to `done`)
- **AND** SHALL navigate to Settings → Network → Servers
- **AND** SHALL configure the remote URL there

#### Scenario: Pre-configured remote via DASHBOARD_PREFER_SOURCE=attach
- **WHEN** the user pre-configures `DASHBOARD_PREFER_SOURCE=attach` (env var) AND a server is already running at the configured port
- **THEN** the startup machine SHALL take the `attach` arm of `selectLaunchSource` (already implemented) and SHALL NOT spawn a local server
- **AND** this env var continues to function as the power-user override (unchanged by this change)
