## ADDED Requirements

### Requirement: Plugin depends on the MCP client plugin

The Apple-tools plugin manifest SHALL declare `dependsOn: ["mcp-client"]` and SHALL NOT declare `pi-mcp-adapter` as a required pi extension or package dependency of its own; that requirement is owned by `mcp-client`. All MCP configuration reads and writes, the adapter-package registration in `~/.pi/agent/settings.json`, and the check-mode parse-status of both files SHALL go through the `mcp-client.config` service (`ensureServerEntry`, `ensureAdapterPackage`, `checkConfigFiles`). The service's `write-failed` refusal maps to the existing `CONFIG_WRITE_FAILED` terminal state and every other refusal to `CONFIG_UNPARSEABLE`, so the closed nine-member state enumeration is unchanged. In the dashboard the service is the consumed instance; the hostless `pi-apple-tools-install` CLI obtains the identical implementation from the MCP client package's exported factory with its own injected IO and paths. Check mode SHALL ask the service's check operation about the same server name and fields the write run would ensure, so both verdicts derive from one validation of the same post-patch entry.

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

## MODIFIED Requirements

### Requirement: Merge-only MCP configuration write

The traversal SHALL register the iMCP server by merging exactly the `mcpServers.iMCP` key into the pi agent MCP configuration file, preserving every sibling server entry and every unrecognised key. The write SHALL be atomic and SHALL refuse to proceed when the existing file is present but unparseable. The write SHALL be performed through the `mcp-client.config` service's ensure-entry operation at global scope; the Apple-tools package SHALL contain no MCP configuration writer of its own.

#### Scenario: Sibling servers survive the write

- **WHEN** the MCP config already contains an unrelated server entry and the installer registers iMCP
- **THEN** the resulting file contains both the unrelated entry and the new `iMCP` entry
- **AND** unrecognised top-level keys in the original file are preserved

#### Scenario: Command points at the discovered binary

- **WHEN** the installer writes the iMCP entry after discovering the binary
- **THEN** the `iMCP` entry's `command`, under whichever servers key the file already uses (`mcpServers` by default), equals the discovered `imcp-server` path

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

- **WHEN** the operator has set `disabled` or `directTools` on the `iMCP` entry via the MCP client and the installer re-runs
- **THEN** `command` is refreshed
- **AND** `disabled` and `directTools` are preserved

### Requirement: Provisioning settings surface

The plugin SHALL contribute a `settings-section` claim exposing the provisioning state, an action to run the installer, and the `imcp-server` path override. The section SHALL derive its state from the same write-suppressed check that backs the command-line and diagnostic surfaces. Per the plugin-settings rendering contract the claim SHALL NOT set `tab`, and no new settings page id SHALL be introduced; the host renders the contribution on the plugin's own settings page at `/settings/plugins/<id>` under host-owned chrome, reached from the settings affordance on the plugin's row. The section SHALL NOT render MCP server controls (enable/disable, direct-tools); it SHALL offer a "Manage MCP servers" link to `/settings/plugins/mcp-client`.

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
- **THEN** it offers the `imcp-server` path override
- **AND** it renders a "Manage MCP servers" link to `/settings/plugins/mcp-client`
- **AND** it renders no enable/disable toggle and no direct-tools selection

#### Scenario: Section is inert on a non-macOS host

- **WHEN** the section renders on a non-macOS host
- **THEN** it reports the unsupported-platform state
- **AND** the run-installer action is not offered

#### Scenario: Disabling the plugin removes the section

- **WHEN** the operator toggles the Apple-tools plugin off
- **THEN** the host reports that a restart is required, because the toggle records desired state while the slot registry follows the server's runtime snapshot
- **AND** after that restart its `settings-section` claim is filtered from the render path

## REMOVED Requirements

### Requirement: Server enable/disable SHALL NOT destroy the installer's entry

**Reason**: Server enable/disable and direct-tools editing are generic MCP configuration and move to the `mcp-client-config` capability ("Disabled flag semantics follow the adapter", "Project-scope writes validate the directory"), which carries identical guarantees for every server, iMCP included. The `apple-tools` `set-disabled` and `set-direct-tools` plugin actions are removed.

**Migration**: Use the MCP client settings page (`/settings/plugins/mcp-client`) or folder page (`/folder/:encodedCwd/mcp`) to toggle iMCP. Programmatic callers use the `mcp-client` plugin's routes or the `mcp-client.config` service.
