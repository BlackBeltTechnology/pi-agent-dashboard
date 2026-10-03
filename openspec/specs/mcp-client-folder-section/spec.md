# mcp-client-folder-section Specification

## Purpose
Folder-scoped MCP surface: a compact pill on each workspace folder and worktree session card, and a full page showing the effective MCP configuration for that directory with folder-layer overrides.

## Requirements

### Requirement: Folder pill on sidebar and worktree cards

The plugin SHALL contribute a `sidebar-folder-section` claim and a `worktree-card-section` claim rendering one compact pill for the folder's cwd. The pill SHALL show the effective server count, the disabled count when non-zero (warning colour), and an error marker when any layer failed to parse (error colour). Activating the pill SHALL open the folder MCP page.

#### Scenario: Pill summarises the effective view

- **WHEN** the cwd resolves to 4 servers of which 1 is disabled
- **THEN** the pill reads "4 servers · 1 off"

#### Scenario: Pill flags a parse error

- **WHEN** any layer for the cwd fails to parse
- **THEN** the pill shows the error marker with the failing path in its accessible name

#### Scenario: Pill opens the folder page

- **WHEN** the pill is activated
- **THEN** the shell navigates to `/folder/<encodedCwd>/mcp`

#### Scenario: Pill on a worktree card uses the worktree's own cwd

- **WHEN** the pill renders inside a worktree session card
- **THEN** the counts reflect the worktree's cwd, not the parent folder's

#### Scenario: Pill renders nothing while loading

- **WHEN** the effective view for the cwd has not yet arrived
- **THEN** the pill renders a muted placeholder of the same height, not an empty element

#### Scenario: Pill for a cwd outside the known folder set

- **WHEN** the card's cwd is not in the host's known folder set
- **THEN** the effective-view request for it is refused by the server
- **AND** the pill renders a muted "not tracked" state
- **AND** no retry is issued for that cwd until the client's session or pinned-folder list changes

### Requirement: Folder page cwd is guarded

The page SHALL render an empty not-allowed state when the server refuses the cwd (admission is server-side; the client has no folder set of its own, per the kb-plugin cwd-guard pattern).

#### Scenario: Unknown cwd in the URL

- **WHEN** the route is opened with an encoded cwd not in the known folder set
- **THEN** the effective-view request is refused
- **AND** the page shows a not-allowed empty state with no retry
- **AND** no server or folder data is rendered

### Requirement: Mobile presentation

Below 640px the editor SHALL open as a bottom sheet, override chips SHALL be display-only with removal offered inside the row's editor, and every action SHALL keep a 44px hit area.

#### Scenario: Chip removal on mobile

- **WHEN** the page renders at 390px width
- **THEN** override chips have no inline remove control
- **AND** the row's editor sheet offers "Remove override"

### Requirement: Folder MCP page follows pi's project rules

The folder page at `/folder/:encodedCwd/mcp` SHALL list the effective servers for that cwd with provenance **Pi global** or **Pi folder**, marking folder entries that replace a global one. When pi does not trust the project, the page SHALL state that folder servers are inactive until the project is trusted, except in dashboard-spawned headless sessions started in that folder (which the bridge trusts per run), and SHALL still allow editing `<cwd>/.pi/mcp.json`.

#### Scenario: Untrusted folder
- **WHEN** the folder has `.pi/mcp.json` and the project is not trusted
- **THEN** the page SHALL show its servers as inactive with the reason "project not trusted"

### Requirement: Folder overrides are whole entries

Editing from the folder page SHALL write only to `<cwd>/.pi/mcp.json`. "Override…" on a global server SHALL open the editor pre-filled with the complete global entry, and saving SHALL write the complete entry to the folder layer, because pi replaces the global entry as a whole. Inherited secrets (`headers`, `env`, `oauth.clientSecret`) SHALL be written only if the operator explicitly re-enters or confirms them; they SHALL NOT be copied silently from the global file. An inherited `auth` block SHALL be left out of the pre-fill with a note that provider auth is global-only.

#### Scenario: Override writes a complete entry
- **WHEN** the operator overrides global `docs` in a folder and changes only `exposure`
- **THEN** `<cwd>/.pi/mcp.json` SHALL contain a complete `docs` entry with the changed `exposure`

#### Scenario: Secrets are not copied silently
- **WHEN** the global `docs` entry has an `Authorization` header and the operator overrides it without touching headers
- **THEN** the folder entry SHALL NOT contain the header value
- **AND** the editor SHALL have warned that the header will be absent unless re-entered
