# apple-tools-provisioning Specification

## Purpose
Provision iMCP — the macOS menu-bar broker for Apple PIM data (Calendar,
Contacts, Reminders, Messages, Location, Maps, Weather) — so a pi session can
reach it through `pi-mcp-adapter`. Covers the installer's terminal-state
machine, its write-suppressed check twin, the merge-only config writes, and the
dashboard/CLI/doctor surfaces that report the resulting state. macOS-only;
Apple Mail is out of scope (iMCP exposes no Mail service).

## Requirements

### Requirement: Platform gate

The provisioning traversal SHALL evaluate `process.platform` before any other check and SHALL terminate immediately on any value other than `darwin`. Termination on a non-macOS platform SHALL be a success (exit code 0), not a failure, because iMCP is structurally macOS-only and its absence on Linux/Windows is not an error condition.

#### Scenario: Non-macOS platform is a clean no-op

- **WHEN** the installer runs with `process.platform` equal to `linux` or `win32`
- **THEN** it terminates with state `UNSUPPORTED_PLATFORM` and exit code 0
- **AND** it emits a message naming iMCP as macOS-only
- **AND** it performs no filesystem write, no `brew` invocation, and no `sw_vers` call

#### Scenario: macOS proceeds past the gate

- **WHEN** the installer runs with `process.platform` equal to `darwin`
- **THEN** the traversal continues to the OS-version check

### Requirement: Minimum macOS version

The traversal SHALL verify the host macOS version is at least 15.3 (iMCP's stated floor) and SHALL terminate with a failure when it is lower. The version SHALL be read from `sw_vers -productVersion` and compared by numeric component, not string comparison.

#### Scenario: macOS below the floor fails loudly

- **WHEN** `sw_vers -productVersion` reports `14.6`
- **THEN** the installer terminates with state `OS_TOO_OLD` and a non-zero exit code
- **AND** the message names both the detected version and the required 15.3 floor
- **AND** no filesystem write occurs

#### Scenario: Version comparison is numeric not lexical

- **WHEN** `sw_vers -productVersion` reports `15.10`
- **THEN** the version is treated as satisfying the 15.3 floor

#### Scenario: Unreadable version is a distinct failure from an old version

- **WHEN** `sw_vers` is absent or exits non-zero
- **THEN** the installer terminates with state `OS_VERSION_UNKNOWN` and a non-zero exit code
- **AND** the message does not assert a detected version, because none was read
- **AND** does not proceed to install anything

### Requirement: iMCP application discovery

The traversal SHALL locate `iMCP.app` by checking an ordered list of candidate directories rather than a single hardcoded path, and SHALL honour an operator-supplied path override ahead of all candidates.

#### Scenario: Application found in the default location

- **WHEN** `/Applications/iMCP.app/Contents/MacOS/imcp-server` exists
- **THEN** the traversal records that path and skips the installation branch

#### Scenario: Application found in a user-local location

- **WHEN** `/Applications/iMCP.app` is absent and `~/Applications/iMCP.app/Contents/MacOS/imcp-server` exists
- **THEN** the traversal records the user-local path and skips the installation branch

#### Scenario: Operator override wins over discovery

- **WHEN** a path override is configured and the file at that path exists
- **THEN** the traversal uses the override without consulting the candidate list

### Requirement: Discovered path is reconciled into plugin configuration

The plugin's server component SHALL persist a discovered non-default binary path into its own `imcpServerPath` configuration, so the declarative path requirement and the plugin's reported status cannot disagree about the same host. This reconciliation is a server responsibility because the plugin configuration store is server-owned; the command-line installer SHALL NOT write plugin configuration.

#### Scenario: Server reconciles a non-default location

- **WHEN** the plugin server's check discovers the binary at a non-default candidate location
- **THEN** the discovered absolute path is persisted to the plugin's `imcpServerPath` configuration
- **AND** a subsequent declarative path probe resolving that key reports the requirement satisfied

#### Scenario: Reconciliation never overwrites an operator override

- **WHEN** the operator has explicitly set a path override and the server's check runs
- **THEN** the override is left unmodified, even when the file it names is currently absent
- **AND** reconciliation writes only when the configured value is unset or still at the schema default

#### Scenario: Command-line installer writes no plugin configuration

- **WHEN** the installer runs from the command line on a host with no dashboard server running
- **THEN** it completes normally and writes only the MCP configuration
- **AND** it does not attempt to reach the plugin configuration store

### Requirement: Guarded application installation

When `iMCP.app` is absent, the traversal SHALL attempt installation via Homebrew only when a `brew` executable is available, and SHALL otherwise terminate with actionable guidance. `brew` SHALL be invoked with an argument vector and SHALL NOT be invoked through a shell.

#### Scenario: Homebrew present triggers cask install

- **WHEN** `iMCP.app` is absent and `brew` resolves
- **THEN** the installer invokes `brew install --cask mattt/tap/iMCP` with an argv array
- **AND** on success re-runs application discovery before continuing

#### Scenario: Homebrew absent yields a download link

- **WHEN** `iMCP.app` is absent and `brew` does not resolve
- **THEN** the installer terminates with state `NO_INSTALL_METHOD` and a non-zero exit code
- **AND** the message contains the direct download URL

#### Scenario: Failed cask install surfaces upstream output

- **WHEN** `brew install --cask` exits non-zero
- **THEN** the installer surfaces Homebrew's own stderr verbatim
- **AND** terminates with state `INSTALL_FAILED` and a non-zero exit code without retrying
- **AND** writes no MCP configuration

### Requirement: Post-installation re-discovery gate

After a successful cask installation the traversal SHALL re-run application discovery and SHALL derive the configured command from the re-discovered path. It SHALL NOT assume the cask landed at the canonical location.

#### Scenario: Re-discovery supplies the configured command

- **WHEN** the cask installs successfully and re-discovery locates the binary
- **THEN** the written `mcpServers.iMCP.command` equals the re-discovered path

#### Scenario: Installed application with no locatable binary fails

- **WHEN** the cask exits zero but re-discovery finds no `imcp-server` at any candidate location
- **THEN** the installer terminates with state `INSTALL_FAILED` and a non-zero exit code
- **AND** writes no MCP configuration, rather than recording a command that points at a nonexistent binary

### Requirement: Merge-only MCP configuration write

The traversal SHALL register the iMCP server by merging exactly the `mcpServers.iMCP` key into pi's global MCP configuration file, preserving every sibling server entry and every unrecognised key. The write SHALL be atomic and SHALL refuse to proceed when the existing file is present but unparseable. The write SHALL be performed through the `mcp-client.config` service's ensure-entry operation at global scope; the Apple-tools package SHALL contain no MCP configuration writer of its own. Tool visibility SHALL be expressed with pi's `exposure` / `toolExposure` fields.

#### Scenario: Sibling servers survive the write

- **WHEN** the MCP config already contains an unrelated server entry and the installer registers iMCP
- **THEN** the resulting file contains both the unrelated entry and the new `iMCP` entry
- **AND** unrecognised top-level keys in the original file are preserved

#### Scenario: Command points at the discovered binary

- **WHEN** the installer writes the iMCP entry after discovering the binary
- **THEN** the `iMCP` entry's `command` under `mcpServers` equals the discovered `imcp-server` path

#### Scenario: Unparseable existing config aborts the write

- **WHEN** the MCP config file exists but is not valid JSON
- **THEN** the installer terminates with state `CONFIG_UNPARSEABLE` and a non-zero exit code reporting the parse error
- **AND** the original file is left byte-identical

#### Scenario: Write is atomic

- **WHEN** the configuration write is interrupted
- **THEN** the target file is either the complete previous content or the complete new content, never truncated

#### Scenario: No credentials are copied between config layers

- **WHEN** the installer writes the iMCP entry
- **THEN** no value from any other MCP configuration layer is copied into the written file

#### Scenario: Operator-set fields on the iMCP entry survive re-provisioning

- **WHEN** the operator has set `enabled`, `exposure` or `toolExposure` on the `iMCP` entry via the MCP client and the installer re-runs
- **THEN** `command` is refreshed
- **AND** `enabled`, `exposure` and `toolExposure` are preserved

### Requirement: Idempotent re-run

Running the installer repeatedly SHALL converge on the same state without duplicating entries or reordering existing ones. The installer SHALL NOT modify pi's settings file.

#### Scenario: Second run produces no change

- **WHEN** the installer runs twice in succession on an already-provisioned machine
- **THEN** the second run reports the same terminal state as the first
- **AND** the MCP config contains exactly one `iMCP` entry

#### Scenario: Existing package list order is preserved

- **WHEN** the installer runs on a machine whose pi settings `packages[]` array is populated
- **THEN** the settings file is left byte-identical

### Requirement: Write-suppressed check mode

The installer SHALL expose a `--check` mode that traverses the identical decision graph with every mutation suppressed and reports the terminal state. Check mode and write mode SHALL share one implementation so their verdicts cannot diverge.

#### Scenario: Check mode never writes

- **WHEN** the installer runs with `--check` on an unprovisioned macOS host
- **THEN** it reports the state it would reach
- **AND** no file is created or modified and `brew` is never invoked

#### Scenario: Check mode reports a provisioned host

- **WHEN** the installer runs with `--check` on a fully provisioned host
- **THEN** it reports state `READY_PENDING_GRANTS` and exit code 0

### Requirement: Manual permission handoff

The traversal SHALL NOT claim that Apple PIM access is functional on the basis of configuration alone, because TCC permission grants cannot be automated. Successful provisioning SHALL terminate in a state that names the outstanding manual step.

#### Scenario: Successful provisioning names the manual step

- **WHEN** the traversal completes every automatable step
- **THEN** it terminates with state `READY_PENDING_GRANTS`
- **AND** the output instructs the operator to open iMCP and activate each service from the menu bar
- **AND** the output states that permission grants cannot be automated

#### Scenario: READY is never asserted by the installer

- **WHEN** the installer completes in any mode
- **THEN** it never reports terminal state `READY`, which is reachable only by a successful live tool round-trip

### Requirement: Opt-in invocation only

Provisioning SHALL execute only on explicit invocation. The package SHALL NOT declare a `postinstall` hook or any other lifecycle script that triggers installation.

#### Scenario: Package installation triggers nothing

- **WHEN** the package is installed as a dependency in any environment
- **THEN** no provisioning traversal runs and `brew` is not invoked

### Requirement: Provisioning state is a closed enumeration

The traversal SHALL report exactly one of a closed set of terminal states so that the CLI, the diagnostic skill, and the settings panel render an identical vocabulary. The closed set has nine members, of which `READY` is reserved for live access: it is NOT reachable by the traversal in either mode, only by a successful tool round-trip through pi's built-in MCP. The traversal therefore reports one of the other eight.

#### Scenario: Terminal states are constrained

- **WHEN** the traversal terminates in any mode
- **THEN** the reported state is one of `UNSUPPORTED_PLATFORM`, `OS_VERSION_UNKNOWN`, `OS_TOO_OLD`, `NO_INSTALL_METHOD`, `INSTALL_FAILED`, `CONFIG_UNPARSEABLE`, `CONFIG_WRITE_FAILED`, `READY_PENDING_GRANTS`
- **AND** `READY` is never among them, being a live-access result rather than a provisioning result

#### Scenario: Every failure path maps to a distinct member

- **WHEN** the traversal terminates because a cask install failed, a configuration file was unparseable, or a parseable configuration could not be written
- **THEN** the reported state is `INSTALL_FAILED`, `CONFIG_UNPARSEABLE`, or `CONFIG_WRITE_FAILED` respectively, not an unnamed error and not a neighbouring member

#### Scenario: Write failure on a parseable config is its own state

- **WHEN** a configuration file parses correctly but cannot be written because of a permission error, a full filesystem, or an uncreatable parent directory
- **THEN** the installer terminates with state `CONFIG_WRITE_FAILED` and a non-zero exit code
- **AND** the original file is left byte-identical

### Requirement: Probes are injectable for test

Every environment probe (platform, OS version, filesystem existence, executable resolution, subprocess invocation) SHALL be injectable so the suite runs deterministically on non-macOS hosts.

#### Scenario: Suite runs on a non-macOS contributor machine

- **WHEN** the installer test suite runs on Linux
- **THEN** every scenario passes using injected probes
- **AND** no test reads a real `/Applications` path or invokes a real `brew`

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

### Requirement: Settings surface SHALL NOT present service toggles it cannot honour

Per-service activation for iMCP is granted through macOS permission dialogs driven from the application's menu bar and has no programmatic interface. The section SHALL NOT render controls implying those services can be toggled from the dashboard.

#### Scenario: No per-service switches are rendered

- **WHEN** the section renders on a fully provisioned host
- **THEN** it renders no control purporting to enable or disable an individual Apple service

#### Scenario: Grant management is delegated with guidance

- **WHEN** the section reports a state pending permission grants
- **THEN** it instructs the operator to activate services from the application's menu bar
- **AND** states that permission grants cannot be automated

### Requirement: Plugin SHALL be registered for production bundling

The plugin SHALL be listed in the Electron bundle's plugin manifest so it ships in production builds. The repository's bundle-completeness test requires every non-fixture dashboard plugin under the packages directory to appear in that list.

#### Scenario: Bundle-completeness test passes

- **WHEN** the bundle-completeness test runs with the Apple-tools plugin present in the packages directory
- **THEN** the plugin appears in the bundled-plugins list and the test passes

#### Scenario: Production build ships the plugin surface

- **WHEN** a production Electron build is produced
- **THEN** the Apple-tools plugin is present in the bundled plugins resource directory

### Requirement: Plugin depends on the MCP client plugin

The Apple-tools plugin manifest SHALL declare `dependsOn: ["mcp-client"]` and SHALL NOT declare `pi-mcp-adapter` as a required pi extension or package dependency. All MCP configuration reads and writes and the check-mode parse-status of the MCP config file SHALL go through the `mcp-client.config` service (`ensureServerEntry`, `checkConfigFiles`); the plugin SHALL NOT register any pi package in `~/.pi/agent/settings.json`. The service's `write-failed` refusal maps to the existing `CONFIG_WRITE_FAILED` terminal state and every other refusal to `CONFIG_UNPARSEABLE`, so the closed nine-member state enumeration is unchanged. In the dashboard the service is the consumed instance; the hostless `pi-apple-tools-install` CLI obtains the identical implementation from the MCP client package's exported factory with its own injected IO and paths. Check mode SHALL ask the service's check operation about the same server name and fields the write run would ensure, so both verdicts derive from one validation of the same post-patch entry.

#### Scenario: Service write failure maps to CONFIG_WRITE_FAILED

- **WHEN** the service reports `write-failed` for the iMCP entry
- **THEN** the installer terminates in `CONFIG_WRITE_FAILED` with the error code in its message

#### Scenario: Check mode predicts the write verdict

- **WHEN** the existing `iMCP` entry defines `url` and check mode runs
- **THEN** check mode reports `CONFIG_UNPARSEABLE` with a transport-conflict message
- **AND** the write run on the same host terminates in the same state without writing

#### Scenario: CLI installer uses the factory-built service

- **WHEN** `pi-apple-tools-install` runs outside the dashboard
- **THEN** its iMCP write goes through the factory-built `mcp-client.config` implementation
- **AND** the Apple-tools package contains no MCP configuration writer

#### Scenario: Loader orders mcp-client first

- **WHEN** both plugins are enabled
- **THEN** `mcp-client` registers before `apple-tools`
- **AND** `apple-tools` observes the `mcp-client.config` service during its own registration

#### Scenario: Disabled dependency gates the plugin

- **WHEN** `mcp-client` is disabled
- **THEN** the plugins index reports `apple-tools` with `mcp-client` in `missingDeps`
- **AND** the Apple-tools server plugin is not loaded

#### Scenario: Cascade toggle warns

- **WHEN** the operator toggles `mcp-client` off while `apple-tools` is enabled
- **THEN** the host's cascade confirmation names `apple-tools` as a dependent

#### Scenario: Settings section reports the missing dependency

- **WHEN** the operator opens `/settings/plugins/apple-tools` while `mcp-client` is disabled or absent (after the restart that applies the toggle), so the Apple-tools row reads `enabled: true, loaded: false, missingDeps: ["mcp-client"]`
- **THEN** the host chrome shows the row's status error naming `mcp-client`
- **AND** the section body still mounts (the client enabled-set filter keys on `enabled`, not `loaded`) and shows a banner stating the MCP client plugin is required with an Enable link to the plugins index, derived from its own row's `missingDeps`
- **AND** the run-installer action is not offered

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
