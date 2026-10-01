## ADDED Requirements

### Requirement: Folder MCP page follows pi's project rules

The folder page at `/folder/:encodedCwd/mcp` SHALL list the effective servers for that cwd with provenance **Pi global** or **Pi folder**, marking folder entries that replace a global one. When pi does not trust the project, the page SHALL state that folder servers are inactive until the project is trusted, and SHALL still allow editing `<cwd>/.pi/mcp.json`.

#### Scenario: Untrusted folder
- **WHEN** the folder has `.pi/mcp.json` and the project is not trusted
- **THEN** the page SHALL show its servers as inactive with the reason "project not trusted"

### Requirement: Folder overrides are whole entries

Editing from the folder page SHALL write only to `<cwd>/.pi/mcp.json`. "Override…" on a global server SHALL open the editor pre-filled with the complete global entry, and saving SHALL write the complete entry to the folder layer, because pi replaces the global entry as a whole. Inherited secrets SHALL be written only if the operator explicitly re-enters or confirms them; they SHALL NOT be copied silently from the global file.

#### Scenario: Override writes a complete entry
- **WHEN** the operator overrides global `docs` in a folder and changes only `exposure`
- **THEN** `<cwd>/.pi/mcp.json` SHALL contain a complete `docs` entry with the changed `exposure`

#### Scenario: Secrets are not copied silently
- **WHEN** the global `docs` entry has an `Authorization` header and the operator overrides it without touching headers
- **THEN** the folder entry SHALL NOT contain the header value
- **AND** the editor SHALL have warned that the header will be absent unless re-entered

## REMOVED Requirements

### Requirement: Folder MCP page
**Reason**: Shared/Other provenance and adapter field inheritance do not exist in pi's built-in MCP. **Migration**: See "Folder MCP page follows pi's project rules".

### Requirement: Folder-scope overrides
**Reason**: pi replaces entries as a whole; field-level patches would produce incomplete entries. **Migration**: See "Folder overrides are whole entries".

### Requirement: Adapter status applies to the folder page
**Reason**: No adapter verdict. **Migration**: None.

### Requirement: Adapter timeout on folder surfaces
**Reason**: No adapter worker to time out. **Migration**: None.
