## MODIFIED Requirements

### Requirement: Wizard SHALL collapse to one welcome step

The Electron first-run wizard (`packages/electron/src/renderer/wizard.html` and `packages/electron/src/lib/wizard-window.ts`) SHALL render a single welcome step with one primary action (`[Launch dashboard]`) and an optional `Advanced ▾` disclosure containing a remote-server URL input with a `[Test Connection]` button. No mode selection, no package selection, no install progress, no completion step SHALL exist.

The wizard window SHALL appear at most once per machine. First-run detection SHALL use the presence of `~/.pi/dashboard/first-run-done` marker file. The marker SHALL be written when the user clicks `[Launch dashboard]` or `[Connect]` in the wizard. On launches when the marker is present, the wizard SHALL be skipped entirely; bootstrap proceeds directly to `launch-server`.

This requirement supersedes the prior four-step wizard (welcome / select / progress / done) which itself replaced the older five- and seven-step flows.

#### Scenario: Wizard opens once on a fresh machine

- **GIVEN** `~/.pi/dashboard/first-run-done` marker does not exist
- **WHEN** the Electron app launches
- **THEN** the wizard window SHALL render the welcome step
- **AND** the window SHALL contain exactly one primary CTA labeled `[Launch dashboard]`
- **AND** the window SHALL NOT contain any package-selection list, install-progress UI, or done step

#### Scenario: Wizard is skipped on second launch

- **GIVEN** `~/.pi/dashboard/first-run-done` marker exists
- **WHEN** the Electron app launches
- **THEN** no wizard window SHALL be created
- **AND** the main process SHALL transition directly to `launch-server`

#### Scenario: Advanced disclosure enables remote connection

- **GIVEN** the wizard welcome step is rendered
- **WHEN** the user expands `Advanced ▾` and enters a URL
- **AND** clicks `[Test Connection]`
- **THEN** the IPC channel `wizard:test-remote-connection` SHALL perform `GET <url>/api/health`
- **AND** success SHALL enable a `[Connect]` button
- **AND** clicking `[Connect]` SHALL write the marker file and load `<url>` in the main window
- **AND** no local server SHALL be spawned

#### Scenario: Wizard does not invoke installStandalone

- **GIVEN** any wizard interaction
- **WHEN** the user clicks `[Launch dashboard]` or `[Connect]`
- **THEN** the wizard SHALL NOT call `installStandalone`, `installBundledExtensions`, or any function that mutates `~/.pi-dashboard/`
- **AND** no IPC channel `wizard:install-*` SHALL exist
