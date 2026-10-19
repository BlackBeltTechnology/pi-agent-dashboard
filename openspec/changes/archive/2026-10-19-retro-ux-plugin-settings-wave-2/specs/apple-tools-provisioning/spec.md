## MODIFIED Requirements

### Requirement: Provisioning settings surface

The plugin SHALL contribute a `settings-section` claim exposing the provisioning state, an action to run the installer, and the `imcp-server` path override. The section SHALL derive its state from the same write-suppressed check that backs the command-line and diagnostic surfaces. Per the plugin-settings rendering contract the claim SHALL NOT set `tab`, and no new settings page id SHALL be introduced; the host renders the contribution on the plugin's own settings page at `/settings/plugins/<id>` under host-owned chrome, reached from the settings affordance on the plugin's row. The section SHALL NOT render a heading or id repeating the plugin's identity ("Apple Tools", `apple-tools`) and SHALL NOT draw its own bordered card inside the host card. The section SHALL NOT render MCP server controls (enable/disable, direct-tools); it SHALL offer a link to `/settings/plugins/mcp-client` (testid `apple-tools-manage-mcp`) labelled "Manage MCP servers", naming MCP Client as the place to turn iMCP on or off and choose its tools.

The `imcp-server` path override SHALL be a labelled "iMCP server path" text field in monospace, with a hint saying to change it only if iMCP is installed somewhere other than Applications, a "Default" pill while it equals the default path, and a Reset action while it differs. Edits to the path SHALL be held as a draft registered with the host Save bar (draft id `plugin:apple-tools`) and written only when the user saves from the host Save bar; the field SHALL NOT write on blur. The run-installer action SHALL show a busy state while it runs and a result notice when it finishes. The existing `apple-tools-*` data-testids and the `imcpServerPath` config key SHALL be preserved.

#### Scenario: Section renders on the plugin's own settings page

- **WHEN** the operator opens the settings affordance on the Apple-tools plugin row
- **THEN** the host navigates to `/settings/plugins/apple-tools`
- **AND** the provisioning section renders exactly once, inside that page's host-owned chrome
- **AND** the section does not render on the plugins index or any other plugin's page
- **AND** no heading in the body equals "Apple Tools" or "Apple Tools (iMCP)", and the literal id `apple-tools` does not appear as body text

#### Scenario: Section reports the provisioning state

- **WHEN** the section renders on an unprovisioned macOS host
- **THEN** it displays the terminal state from the shared provisioning check as a word pill
- **AND** the state shown corresponds to what the command-line check reports for the same host

#### Scenario: Run-installer action provisions the host

- **WHEN** the operator triggers the run-installer action AND the iMCP application is already present on disk
- **THEN** the provisioning traversal runs in write mode
- **AND** the action shows a busy state and cannot be triggered again until it finishes
- **AND** the section refreshes to the resulting state and shows a result notice

#### Scenario: The dashboard never runs the network install in-process

The install branch shells out to `brew install --cask` under a ten-minute
timeout. The traversal is synchronous, so running that branch inside the
dashboard server would block its event loop for the duration, stalling every
session's WebSocket and every other plugin's HTTP. Provisioning is therefore
split: the server performs only the fast configuration-write half, and the
command-line entry point owns the long, network-bound install.

- **WHEN** the operator opens the section on a supported host where the iMCP application is absent
- **THEN** the section reports that the application is not installed and names the command-line installer `pi-apple-tools-install` as code
- **AND** offers a "Copy command" action that copies `pi-apple-tools-install` and a "Check again" action that refreshes the state
- **AND** the run-installer action is not offered, so no action can block the event loop
- **AND** the server refuses the action if it is invoked by other means

#### Scenario: Section exposes the tunable values

- **WHEN** the section renders
- **THEN** it offers the "iMCP server path" field for the `imcp-server` path override
- **AND** it renders a link to `/settings/plugins/mcp-client`
- **AND** it renders no enable/disable toggle and no direct-tools selection

#### Scenario: Path edit goes through the host Save bar

- **WHEN** the operator changes the "iMCP server path" field and moves focus away
- **THEN** no config write happens and the host Save bar shows unsaved changes
- **AND** saving from the host Save bar writes `imcpServerPath` via `plugin_config_write` while keeping the other config keys

#### Scenario: Path default and reset

- **WHEN** the path field holds the default `/Applications/iMCP.app/Contents/MacOS/imcp-server`
- **THEN** it shows a "Default" pill and no Reset action
- **AND** when the value differs from the default a Reset action is shown that restores the default into the draft

#### Scenario: Section is inert on a non-macOS host

- **WHEN** the section renders on a non-macOS host
- **THEN** it reports the unsupported-platform state
- **AND** the run-installer action is not offered

#### Scenario: Disabling the plugin removes the section

- **WHEN** the operator toggles the Apple-tools plugin off
- **THEN** the host reports that a restart is required, because the toggle records desired state while the slot registry follows the server's runtime snapshot
- **AND** after that restart its `settings-section` claim is filtered from the render path

## ADDED Requirements

### Requirement: Provisioning state shown as a word pill with a fix-naming notice

The settings section SHALL show the provisioning state as a status pill carrying a human word, an icon and a severity tone, never the raw state token (for example `OS_TOO_OLD`) and never colour alone. The pill SHALL be chosen in this order. First, two UI-only labels that are NOT members of the closed enumeration and never appear in the CLI or diagnostic vocabulary: "Checking" (info) while the status request has not settled, and "Not installed" (neutral) when the status payload reports `READY_PENDING_GRANTS` with `appPresent: false` (check mode predicts that state for an absent app when an install method exists). Every failure member below takes precedence over `appPresent`. Otherwise the pill maps the reported member one-to-one: "Installed" (success) for `READY_PENDING_GRANTS` with the app present, whose info notice SHALL name the outstanding manual step (grant access in the iMCP menu-bar app); "macOS too old" (warning) for `OS_TOO_OLD`; "macOS version unknown" (warning) for `OS_VERSION_UNKNOWN`; "Unsupported platform" (neutral) for `UNSUPPORTED_PLATFORM`; "Can't install automatically" (warning) for `NO_INSTALL_METHOD`; "Install failed" (error) for `INSTALL_FAILED`; "Config unreadable" (error) for `CONFIG_UNPARSEABLE`; "Config not saved" (error) for `CONFIG_WRITE_FAILED`. The settings section reads only the status route's check-mode result, which never reports `READY` (a live-access result); the section SHALL NOT probe live MCP access itself, so it shows no "Ready" pill and "Installed" is its healthy state. Whenever the pill is not Installed or Checking, a notice in the matching tone SHALL say in one sentence what to do next.

#### Scenario: macOS too old names the fix

- **WHEN** the check reports `OS_TOO_OLD` on a Mac running 14.6.1
- **THEN** the section shows a warning-tone "macOS too old" pill
- **AND** a warning notice states the minimum macOS version iMCP needs, the version this Mac runs, and to update macOS before installing iMCP
- **AND** the text `OS_TOO_OLD` does not appear

#### Scenario: Not installed

- **WHEN** the status payload reports `READY_PENDING_GRANTS` with `appPresent: false` on a supported Mac
- **THEN** the section shows a "Not installed" pill, not "Installed"

#### Scenario: Failure state wins over an absent app

- **WHEN** the status payload reports `NO_INSTALL_METHOD` with `appPresent: false`
- **THEN** the section shows a warning-tone "Can't install automatically" pill, not "Not installed"

#### Scenario: Not installed offers the command

- **WHEN** the section shows "Not installed"
- **THEN** the section shows a "Not installed" pill and an info notice naming `pi-apple-tools-install` with "Copy command" and "Check again" actions

#### Scenario: Installed names the manual step

- **WHEN** the status payload reports `READY_PENDING_GRANTS` with `appPresent: true`
- **THEN** the section shows a success-tone "Installed" pill
- **AND** an info notice says to grant Calendar, Contacts and other access in the iMCP menu-bar app

#### Scenario: Permissions guidance stays visible

- **WHEN** the section shows "Installed"
- **THEN** the guidance that Apple permissions are granted in the iMCP menu-bar app and cannot be changed from this page remains visible

#### Scenario: Checking

- **WHEN** the status request has not settled
- **THEN** the section shows an info-tone "Checking" pill and offers no run-installer action yet

### Requirement: Provisioning status errors are human sentences

When the provisioning status cannot be read, the section SHALL show an error notice with one sentence naming the problem (for example "Could not check iMCP on this Mac. The dashboard server did not answer."), a "Try again" action that re-requests the status, and a "Copy details" action holding the raw detail (such as an HTTP status code). Raw error text and HTTP codes SHALL NOT be shown in the notice itself. The path field SHALL remain available while the status is unavailable.

#### Scenario: Status request fails

- **WHEN** the status request fails with HTTP 404
- **THEN** the section shows an error notice (`apple-tools-error`) with a human sentence, "Try again" and "Copy details"
- **AND** the text "404" appears only in the copied details, not in the notice

#### Scenario: Try again recovers

- **WHEN** the operator activates "Try again" and the status request then succeeds
- **THEN** the error notice disappears and the state pill shows the reported state
