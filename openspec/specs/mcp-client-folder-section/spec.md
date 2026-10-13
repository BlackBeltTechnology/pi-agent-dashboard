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
- **AND** this applies only to a `403` refusal; a `503 cwd-admission-unavailable` SHALL NOT be recorded as not tracked

#### Scenario: Transient admission failure is retried
- **WHEN** the effective-view request for the card's cwd returns `503` with `error: "cwd-admission-unavailable"`
- **THEN** the pill keeps its loading placeholder and retries with jittered exponential backoff derived from the response's `retryAfterMs` (about 1 s, 2 s, 4 s, each ±25 %)
- **AND** the cwd is NOT recorded as not tracked
- **AND** a later `200` renders the normal summary

#### Scenario: Transient failure exhausts retries
- **WHEN** the effective-view request returns `503 cwd-admission-unavailable` on the initial attempt and all 3 retries
- **THEN** the pill renders its error marker, not the "not tracked" state
- **AND** a later change to the client's session or pinned-folder list, or an explicit reload, retries again

### Requirement: Folder page cwd is guarded

The page SHALL render an empty not-allowed state when the server refuses the cwd with `403`. A `503 cwd-admission-unavailable` is not a refusal: the page SHALL keep its loading state while retrying with backoff, and after the retries are exhausted SHALL render an error state with a Retry action (admission is server-side; the client has no folder set of its own, per the kb-plugin cwd-guard pattern).

#### Scenario: Unknown cwd in the URL

- **WHEN** the route is opened with an encoded cwd not in the known folder set
- **THEN** the effective-view request is refused
- **AND** the page shows a not-allowed empty state with no retry
- **AND** no server or folder data is rendered

#### Scenario: Transient admission failure on the folder page
- **WHEN** the route is opened for a cwd whose effective-view request returns `503 cwd-admission-unavailable` and then `200`
- **THEN** the page shows its loading state, retries, and renders the folder's servers
- **AND** never shows the not-allowed empty state

### Requirement: Mobile presentation

Below 640px the editor and the "Project settings…" panel SHALL open as a bottom sheet, override chips and per-folder badges SHALL be display-only with removal, "Reset to global" and "Convert to project override" offered inside the row's sheet, and every action SHALL keep a 44px hit area.

#### Scenario: Chip removal on mobile

- **WHEN** the page renders at 390px width
- **THEN** override chips have no inline remove control
- **AND** the row's editor sheet offers "Remove override"

#### Scenario: Per-folder controls on mobile
- **WHEN** the page renders at 390px width and global `docs` is off in this folder
- **THEN** the "Off in this folder" badge SHALL have no inline action
- **AND** the row's sheet SHALL offer "Reset to global" and "Project settings…" with 44px hit areas

### Requirement: Folder MCP page follows pi's project rules

The folder page at `/folder/:encodedCwd/mcp` SHALL list the effective servers for that cwd with provenance **Pi global** or **Pi folder**, marking folder entries that replace a global one and marking global servers carrying a project override with the overridden setting in text (for example "Off in this folder"), never by colour alone. Rows reporting an orphaned or invalid project override SHALL show pi's message with a "Remove" action and SHALL NOT be counted as servers by the folder pill, because pi loads nothing for them. When pi does not trust the project, the page SHALL state that folder servers are inactive until the project is trusted, except in dashboard-spawned headless sessions started in that folder (which the bridge trusts per run), and SHALL still allow editing `<cwd>/.pi/mcp.json`.

#### Scenario: Untrusted folder
- **WHEN** the folder has `.pi/mcp.json` and the project is not trusted
- **THEN** the page SHALL show its servers as inactive with the reason "project not trusted"

#### Scenario: Overridden global server is marked
- **WHEN** the trusted folder overrides global `docs` with `{ "enabled": false }`
- **THEN** the page SHALL show one `docs` row, badged Pi global, switched off, with the text "Off in this folder" and a "Reset to global" action

#### Scenario: Orphaned override is not counted
- **WHEN** the trusted folder has `"ghost": { "enabled": false }`, no global `ghost` exists, and 2 other servers are effective
- **THEN** the folder pill SHALL read "2 servers" with no off count contributed by `ghost`
- **AND** the page SHALL show the `ghost` row with pi's message and a "Remove" action, and its switch SHALL be unavailable

#### Scenario: Removing an orphaned override can be undone
- **WHEN** the operator removes the `ghost` override row and then undoes
- **THEN** `<cwd>/.pi/mcp.json` SHALL contain the identical `ghost` override again

### Requirement: Per-project settings override global servers in place

On the folder page, every Pi-global server row that pi keeps SHALL offer a per-folder switch and a "Project settings…" panel that write only a project override to `<cwd>/.pi/mcp.json`. The switch SHALL show the effective state and SHALL write the smallest override producing the requested state. The panel SHALL offer `enabled` as a three-way radio group — Inherit (no key), On (`true`), Off (`false`) — operable with arrow keys and labelled in text, and `exposure` as "Inherit (<global value>)" or one of pi's exposures. An override's `toolExposure` SHALL be shown read-only and preserved by every write. "Reset to global" SHALL remove the override entry and SHALL offer an undo that restores it exactly. When the global server is shadowed by a whole-entry folder entry, these controls SHALL be unavailable on the global row. When pi does not trust the project, the controls SHALL stay available and a saved change SHALL be labelled as applying once the project is trusted.

#### Scenario: Turn a global server off for one folder
- **WHEN** the operator switches global `docs` off on the folder page of a trusted project
- **THEN** `<cwd>/.pi/mcp.json` SHALL contain `"docs": { "enabled": false }`
- **AND** the row SHALL read "Off in this folder" and the global file SHALL be unchanged

#### Scenario: Inherit follows later global changes
- **WHEN** the folder's `docs` setting is Inherit and the operator later disables `docs` in Pi-global settings
- **THEN** the folder page SHALL show `docs` off with no folder badge

#### Scenario: Exposure override keeps credentials
- **WHEN** the operator sets exposure Direct for global `docs` (which has an `Authorization` header) in the panel
- **THEN** the folder override SHALL be `{ "exposure": "direct" }` and SHALL contain no header

#### Scenario: Reset to global with undo
- **WHEN** the operator chooses "Reset to global" on a row whose override is `{ "enabled": false, "toolExposure": { "search": "direct" } }` and then undoes
- **THEN** the override entry SHALL first be removed and then restored identical

#### Scenario: Radio group is keyboard operable
- **WHEN** focus is on the enabled radio group showing Inherit and the operator presses the right arrow key
- **THEN** On SHALL be selected and announced by its text label

#### Scenario: Untrusted project explains a pending change
- **WHEN** the project is not trusted and the operator switches global `docs` off
- **THEN** `<cwd>/.pi/mcp.json` SHALL contain `"docs": { "enabled": false }`
- **AND** the row SHALL state that the change applies once the project is trusted, while `docs` stays shown as on

### Requirement: Replacing a global server writes a whole folder entry

"Replace with folder entry…" on a global row SHALL open the editor pre-filled with the global entry minus secret-bearing values (`headers`, `env`, `oauth.clientSecret`) and `auth`, and saving SHALL write a complete entry to the folder layer, because a project entry with a transport replaces the global entry as a whole. Omitted secrets SHALL be written only if the operator explicitly re-enters or confirms them; they SHALL NOT be copied silently. The `auth` block SHALL be left out with a note that provider auth is global-only.

#### Scenario: Replace writes a complete entry
- **WHEN** the operator replaces global `docs` in a folder and changes only its `url`
- **THEN** `<cwd>/.pi/mcp.json` SHALL contain a complete `docs` entry with the changed `url`

#### Scenario: Secrets are not copied silently
- **WHEN** the global `docs` entry has an `Authorization` header and the operator replaces it without touching headers
- **THEN** the folder entry SHALL NOT contain the header value
- **AND** the editor SHALL have warned that the header will be absent unless re-entered

### Requirement: Legacy folder copies can be converted to overrides

A folder entry SHALL be treated as a legacy copy only when it and the global entry of the same name are both full entries (a string `command` or a string `url`), the folder entry carries none of `headers`, `env`, `auth` and `oauth.clientSecret`, and the folder entry without `enabled`, `exposure` and `toolExposure` equals the global entry without those keys and without the secret-bearing fields. Such a row SHALL state that it is a copy without credentials and SHALL offer "Convert to project override", which rewrites the entry to only those of its `enabled`, `exposure` and `toolExposure` keys whose value differs from the global entry's, or removes it when none differ, with an undo restoring the original entry. A folder entry failing any condition SHALL NOT be offered conversion. No conversion SHALL happen without the operator's action.

#### Scenario: Legacy disabled copy converts
- **WHEN** the folder has a copy of global `docs` without its header and with `enabled: false` and the global `exposure`, and the operator converts it
- **THEN** the folder entry SHALL become exactly `{ "enabled": false }` and the effective `docs` SHALL carry the global header again

#### Scenario: Re-entered secret vetoes conversion
- **WHEN** the folder's `docs` entry equals the global one except that it carries a re-entered `Authorization` header
- **THEN** no conversion SHALL be offered

#### Scenario: Deliberate replace not offered conversion
- **WHEN** the folder's `docs` entry has a different `url` from the global one
- **THEN** no conversion SHALL be offered

#### Scenario: Conversion undo restores the copy
- **WHEN** the operator converts a legacy copy and then undoes
- **THEN** the folder file SHALL contain the original copy unchanged
