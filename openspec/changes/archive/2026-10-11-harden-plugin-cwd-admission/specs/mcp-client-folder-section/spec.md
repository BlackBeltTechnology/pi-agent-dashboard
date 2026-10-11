## MODIFIED Requirements

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
