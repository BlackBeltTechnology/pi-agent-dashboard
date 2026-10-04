## MODIFIED Requirements

### Requirement: OpenSpec proposal preview route
The client SHALL define a route `/folder/:encodedCwd/openspec/:changeName/:artifactId` that renders the OpenSpec proposal preview for the specified change and artifact. `:encodedCwd` is base64url-encoded via `encodeFolderPath`. `:changeName` and `:artifactId` are `encodeURIComponent`-encoded. The preview SHALL NOT render when `:changeName` is `archive`; that path space belongs to the archive routes.

#### Scenario: Direct navigation to preview URL
- **WHEN** user navigates to `/folder/:encodedCwd/openspec/my-change/proposal`
- **THEN** the OpenSpecPreview component SHALL be rendered with `cwd`, `changeName="my-change"`, and `initialArtifact="proposal"` derived from the URL

#### Scenario: Refresh on preview URL
- **WHEN** user refreshes the page at the preview URL with no in-memory state
- **THEN** the page SHALL show a loading state until WebSocket replay populates `openspecMap`
- **THEN** the preview SHALL render once data is available

#### Scenario: Invalid change name in URL
- **WHEN** user navigates to a preview URL with a `:changeName` that does not exist in the folder's openspec data
- **THEN** the page SHALL render a "Not found" inline component with a back button — NOT redirect to `/` automatically

## ADDED Requirements

### Requirement: Archive artifact deep-link route
The client SHALL define a route `/folder/:encodedCwd/openspec/archive/:entry/:artifact`. It SHALL render the archive artifact reader for archive entry `:entry` of the decoded cwd, with `:artifact` (`proposal`, `design`, `tasks` or `specs`) selected.

The route SHALL be a depth-2 overlay covered by the `/folder/:cwd/openspec/*` entry of the back-action table. Back SHALL use history-back semantics. On a cold load, the existing back-action rule for `/folder/:cwd/openspec/*` applies.

Every `/folder/:encodedCwd/openspec/archive/...` route SHALL take precedence over the change-preview route `/folder/:encodedCwd/openspec/:changeName/:artifactId`: the preview route SHALL NOT render when `changeName` is `archive`. `/folder/:encodedCwd/openspec/archive/:entry` without an artifact SHALL render the archive list.

When `:entry` does not exist in the archive, or `:artifact` is not among its artifacts, the client SHALL render the archive browser list for that cwd instead.

#### Scenario: Open archived design directly
- **WHEN** the user navigates to `/folder/<enc /repo>/openspec/archive/2026-09-30-add-auth/design`
- **THEN** the archive artifact reader SHALL render `design` of `2026-09-30-add-auth`

#### Scenario: Back returns to the launching view
- **WHEN** the reader was opened from a session card letter and the user presses Back
- **THEN** the session view SHALL be restored

#### Scenario: Unknown entry falls back to list
- **WHEN** the user navigates to an archive entry that does not exist
- **THEN** the archive browser list for that cwd SHALL render

#### Scenario: Archive path never renders the change preview
- **WHEN** the user navigates to `/folder/<enc /repo>/openspec/archive/2026-09-30-add-auth`
- **THEN** the archive browser list SHALL render
- **AND** the change-preview route SHALL NOT handle it
