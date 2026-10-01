## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Settings file write carries the same guarantees as the MCP config write

**Reason**: The installer no longer registers `pi-mcp-adapter` in `settings.json#packages`; doing so would disable pi's built-in MCP.

**Migration**: None; pi's built-in MCP needs no package entry.
