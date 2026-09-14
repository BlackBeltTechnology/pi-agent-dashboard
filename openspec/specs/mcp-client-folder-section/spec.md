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

### Requirement: Folder MCP page

The plugin SHALL contribute a `shell-overlay-route` at `/folder/:encodedCwd/mcp`. The page SHALL list the effective servers for that cwd with provenance using the vocabulary **Shared**, **Pi global**, **Pi folder**, **Other**, and show the adapter's effective value of each field with an "inherited from <layer>" hint for every field the folder-layer entry does not define.

#### Scenario: Effective rows show inheritance

- **WHEN** a server is defined in Pi global and not in Pi folder
- **THEN** its row shows provenance Pi global
- **AND** its editor fields carry the inherited hint

#### Scenario: Folder override row

- **WHEN** a server key is defined in `<cwd>/.pi/mcp.json`
- **THEN** its row shows an override chip listing the overridden field names
- **AND** the chip is removable

#### Scenario: Back returns to the previous shell view

- **WHEN** the operator activates Back
- **THEN** the shell returns to the view that opened the page

### Requirement: Folder page cwd is guarded

The page SHALL render an empty not-allowed state when the server refuses the cwd (admission is server-side; the client has no folder set of its own, per the kb-plugin cwd-guard pattern).

#### Scenario: Unknown cwd in the URL

- **WHEN** the route is opened with an encoded cwd not in the known folder set
- **THEN** the effective-view request is refused
- **AND** the page shows a not-allowed empty state with no retry
- **AND** no server or folder data is rendered

### Requirement: Folder-scope overrides

Editing from the folder page SHALL write only to `<cwd>/.pi/mcp.json`. "Override…" on an inherited server SHALL open the editor showing the effective values, every field marked inherited; changing a field SHALL send a patch for that key only, and inherited values (including inherited secrets, which the server redacts and the editor renders as a placeholder without reveal) SHALL never be sent. Overriding a layer-atomic object field (`env`, `headers`, `searchKeywords`, `oauth`, `requestHeadersCommand`, per the schema marker) SHALL be an explicit action that starts from an empty object and states how many inherited keys (and secrets) will stop applying at this layer. Removing an override SHALL delete that server's key from the folder layer and show an undo toast rather than a confirm dialog; undo re-submits the removed entry returned by the remove call.

#### Scenario: Overriding an inherited record warns and starts empty

- **WHEN** the operator chooses to override `env` on a server whose `env` is inherited with 3 keys including 1 secret
- **THEN** the editor states that 3 inherited keys including 1 secret will no longer apply
- **AND** the override record starts empty
- **AND** the redacted secret is never included in the patch

#### Scenario: Override writes a single key

- **WHEN** the operator overrides an inherited server and changes `disabled`
- **THEN** `<cwd>/.pi/mcp.json` contains that server with only `disabled`
- **AND** `~/.pi/agent/mcp.json` is unchanged

#### Scenario: Remove override with undo

- **WHEN** the operator removes an override chip
- **THEN** the folder layer entry is deleted
- **AND** an undo toast appears
- **AND** activating Undo restores the exact previous entry

#### Scenario: Folder-scope enable/disable

- **WHEN** the operator switches a server off on the folder page
- **THEN** `disabled: true` is written at project scope for that cwd

#### Scenario: Folder-scope enable over a disabling lower layer

- **WHEN** a server disabled at Pi global is switched on at the folder page
- **THEN** the folder layer entry contains `disabled: false`
- **AND** the pill's disabled count decreases by one

### Requirement: Adapter status applies to the folder page

The folder page SHALL apply the same adapter-status read-only rule as the global settings section.

#### Scenario: Below-floor locks folder edits

- **WHEN** the verdict is not `ok`
- **THEN** the folder page shows the banner
- **AND** every switch, Override, and Save control is disabled

### Requirement: Adapter timeout on folder surfaces

When the effective-view request for a cwd returns `504 adapter-timeout`, the pill SHALL show the error marker (accessible name naming the timeout) and the folder page SHALL show an error state with a retry action; neither SHALL render stale server data as current.

#### Scenario: Folder page timeout

- **WHEN** the folder page's effective-view request returns `504`
- **THEN** the page shows the timeout error with a retry action
- **AND** activating retry issues exactly one new request

### Requirement: Mobile presentation

Below 640px the editor SHALL open as a bottom sheet, override chips SHALL be display-only with removal offered inside the row's editor, and every action SHALL keep a 44px hit area.

#### Scenario: Chip removal on mobile

- **WHEN** the page renders at 390px width
- **THEN** override chips have no inline remove control
- **AND** the row's editor sheet offers "Remove override"
