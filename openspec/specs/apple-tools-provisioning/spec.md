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
- **THEN** it completes normally and writes only the MCP configuration and the pi settings file
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

The traversal SHALL register the iMCP server by merging exactly the `mcpServers.iMCP` key into the pi agent MCP configuration file, preserving every sibling server entry and every unrecognised key. The write SHALL be atomic and SHALL refuse to proceed when the existing file is present but unparseable.

#### Scenario: Sibling servers survive the write

- **WHEN** the MCP config already contains an unrelated server entry and the installer registers iMCP
- **THEN** the resulting file contains both the unrelated entry and the new `iMCP` entry
- **AND** unrecognised top-level keys in the original file are preserved

#### Scenario: Command points at the discovered binary

- **WHEN** the installer writes the iMCP entry after discovering the binary
- **THEN** `mcpServers.iMCP.command` equals the discovered `imcp-server` path

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

### Requirement: Idempotent re-run

Running the installer repeatedly SHALL converge on the same state without duplicating entries or reordering existing ones.

#### Scenario: Second run produces no change

- **WHEN** the installer runs twice in succession on an already-provisioned machine
- **THEN** the second run reports the same terminal state as the first
- **AND** the MCP config contains exactly one `iMCP` entry
- **AND** the pi settings `packages[]` array contains at most one `pi-mcp-adapter` entry

#### Scenario: Existing package list order is preserved

- **WHEN** the installer appends the MCP adapter to a populated `packages[]` array
- **THEN** the pre-existing entries retain their original relative order

### Requirement: Settings file write carries the same guarantees as the MCP config write

The `packages[]` append to the pi settings file SHALL be merge-only, atomic, and SHALL abort rather than overwrite when the existing file is unparseable — identical discipline to the MCP config write. Presence detection SHALL use the repository's cross-kind source matcher rather than exact string equality, so an entry installed from a different source kind is recognised.

#### Scenario: Unparseable settings file aborts the append

- **WHEN** the pi settings file exists but is not valid JSON
- **THEN** the installer terminates with state `CONFIG_UNPARSEABLE` and a non-zero exit code
- **AND** the original file is left byte-identical

#### Scenario: Settings write is atomic

- **WHEN** the settings-file write is interrupted
- **THEN** the target file is either the complete previous content or the complete new content, never truncated

#### Scenario: Git-sourced adapter is recognised as already present

- **WHEN** `packages[]` already contains a git-sourced entry for the MCP adapter and the installer runs
- **THEN** no npm-sourced duplicate is appended
- **AND** the existing entry is left unmodified

#### Scenario: Unrelated packages survive the append

- **WHEN** the installer appends to a `packages[]` array containing unrelated entries
- **THEN** every unrelated entry is preserved and no entry is removed

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

The traversal SHALL report exactly one of a closed set of terminal states so that the CLI, the diagnostic skill, and the settings panel render an identical vocabulary. The closed set has nine members, of which `READY` is reserved for live access: it is NOT reachable by the traversal in either mode, only by a successful tool round-trip through the adapter. The traversal therefore reports one of the other eight.

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

The plugin SHALL contribute a `settings-section` claim exposing the provisioning state, an action to run the installer, and the operator-tunable configuration values. The section SHALL derive its state from the same write-suppressed check that backs the command-line and diagnostic surfaces. Per the plugin-settings rendering contract the claim SHALL NOT set `tab`, and no new settings page id SHALL be introduced; the host renders the contribution on the plugin's own settings page at `/settings/plugins/<id>` under host-owned chrome, reached from the settings affordance on the plugin's row.

#### Scenario: Section renders on the plugin's own settings page

- **WHEN** the operator opens the settings affordance on the Apple-tools plugin row
- **THEN** the host navigates to `/settings/plugins/apple-tools`
- **AND** the provisioning section renders exactly once, inside that page's host-owned chrome
- **AND** the section does not render on the plugins index or any other plugin's page

#### Scenario: Section reports the provisioning state

- **WHEN** the section renders on an unprovisioned macOS host
- **THEN** it displays the terminal state from the shared provisioning check
- **AND** the state vocabulary matches what the command-line check reports for the same host

#### Scenario: Run-installer action provisions the host

- **WHEN** the operator triggers the run-installer action AND the iMCP application is already present on disk
- **THEN** the provisioning traversal runs in write mode
- **AND** the section refreshes to the resulting state

#### Scenario: The dashboard never runs the network install in-process

The install branch shells out to `brew install --cask` under a ten-minute
timeout. The traversal is synchronous, so running that branch inside the
dashboard server would block its event loop for the duration, stalling every
session's WebSocket and every other plugin's HTTP. Provisioning is therefore
split: the server performs only the fast configuration-write half, and the
command-line entry point owns the long, network-bound install.

- **WHEN** the operator opens the section on a supported host where the iMCP application is absent
- **THEN** the section reports that the application is not installed and names the command-line installer
- **AND** the run-installer action is not offered, so no action can block the event loop
- **AND** the server refuses the action if it is invoked by other means

#### Scenario: Section exposes the tunable values

- **WHEN** the section renders
- **THEN** it offers the iMCP server enable/disable toggle, the direct-tools selection, and the `imcp-server` path override

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

### Requirement: Server enable/disable SHALL NOT destroy the installer's entry

Disabling the iMCP server SHALL be expressed as a `disabled` flag merged into the adapter's configuration, never by rewriting or removing the entry the installer wrote. Two scopes SHALL be supported, because the surfaces that offer the control differ in what they know:

- **global** — `~/.pi/agent/mcp.json`, the layer the installer also writes `command` to. This is the target for the plugin's settings page, which is host-owned and global and therefore has no project directory to scope a write to.
- **project** — `<cwd>/.pi/mcp.json`, the adapter's highest-precedence layer, for surfaces that do know a project. A project value overrides the global one without mutating it.

A project scope write SHALL validate the supplied directory against the host's known folder set before touching the filesystem. Disabling SHALL write `disabled: true`; enabling SHALL remove the key rather than writing `false`, matching the adapter, which treats only a literal `true` as disabled.

#### Scenario: Disabling leaves the installer's command entry intact

- **WHEN** the operator disables the iMCP server from the settings section
- **THEN** the disable flag is merged into the global adapter configuration
- **AND** the installer-written `command` value on that entry is unmodified
- **AND** every sibling MCP server entry is preserved verbatim

#### Scenario: A project scope override folds over the global value

- **WHEN** a project-scoped surface disables the server for a known project directory
- **THEN** the flag is written to that project's adapter configuration layer
- **AND** the global configuration is left untouched

#### Scenario: An unknown project directory is refused

- **WHEN** a project scope disable names a directory outside the host's known folder set
- **THEN** no filesystem write occurs

### Requirement: Plugin SHALL be registered for production bundling

The plugin SHALL be listed in the Electron bundle's plugin manifest so it ships in production builds. The repository's bundle-completeness test requires every non-fixture dashboard plugin under the packages directory to appear in that list.

#### Scenario: Bundle-completeness test passes

- **WHEN** the bundle-completeness test runs with the Apple-tools plugin present in the packages directory
- **THEN** the plugin appears in the bundled-plugins list and the test passes

#### Scenario: Production build ships the plugin surface

- **WHEN** a production Electron build is produced
- **THEN** the Apple-tools plugin is present in the bundled plugins resource directory

