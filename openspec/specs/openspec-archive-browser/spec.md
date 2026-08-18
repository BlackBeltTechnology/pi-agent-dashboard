# openspec-archive-browser Specification

## Purpose

Lets the user read archived OpenSpec changes from the dashboard. Defines the archive listing endpoint and artifact detection, the two-level browse-and-navigate view, and the filtering model: group sections with a pill row, pill selection narrowing entries, the search input acting as the unified name-substring filter, per-entry group assignment, date sub-grouping preserved within groups, and a manage-groups link reusing the shared manager component.

## Requirements

### Requirement: Archive listing endpoint
The server SHALL expose `GET /api/openspec-archive?cwd=<path>` that returns all archived changes for the given directory.

#### Scenario: Successful listing
- **WHEN** a GET request is made to `/api/openspec-archive?cwd=/project/foo` and the directory has archived changes
- **THEN** the response SHALL be `{ success: true, data: [...] }` where each entry contains `name` (string), `date` (string, YYYY-MM-DD), and `artifacts` (array of `{ id, status }`)

#### Scenario: No archive directory
- **WHEN** a GET request is made and `openspec/changes/archive/` does not exist in the cwd
- **THEN** the response SHALL be `{ success: true, data: [] }`

#### Scenario: Missing cwd parameter
- **WHEN** a GET request is made without a `cwd` query parameter
- **THEN** the response SHALL return 400 with `{ success: false, error: "Missing cwd" }`

### Requirement: Archive entry artifact detection
Each archive entry SHALL include detected artifacts based on file existence in the archive directory.

#### Scenario: Entry with all artifacts
- **WHEN** archive entry `2026-03-27-openspec-artifact-reader/` contains `proposal.md`, `design.md`, `tasks.md`, and `specs/` directory
- **THEN** the artifacts array SHALL include entries for proposal, design, specs, and tasks, all with status "done"

#### Scenario: Entry with partial artifacts
- **WHEN** archive entry `2026-03-22-auto-shutdown/` contains only `proposal.md` and `tasks.md`
- **THEN** the artifacts array SHALL include only proposal and tasks

### Requirement: Archive browser view
The dashboard SHALL provide an `ArchiveBrowserView` content-area component that displays archived changes in a searchable, date-grouped list. **When the cwd has at least one defined group, the entry list SHALL additionally be partitioned into collapsible group sections (named groups in `group.order`, then the implicit Ungrouped section last). When the cwd has zero groups, the view renders the flat date-grouped layout exactly as today.**

#### Scenario: Initial render with zero groups → today's layout
- **WHEN** the archive browser opens for cwd `/project/foo` and `groups.length === 0`
- **THEN** it SHALL fetch the archive listing and display entries grouped by date, newest-first, with a search input at the top
- **AND** no pill row, no group section headers SHALL render

#### Scenario: Initial render with groups defined
- **WHEN** the archive browser opens for cwd `/project/foo` and at least one group is defined
- **THEN** it SHALL fetch the archive listing AND fetch `/api/openspec/groups?cwd=/project/foo`
- **AND** display a pill row, the search input, and the entry list partitioned into group sections (named groups in `group.order`, then Ungrouped last) with date sub-grouping inside each section

#### Scenario: Search filters by name (zero groups)
- **WHEN** `groups.length === 0` and the user types "auth" in the search input
- **THEN** only entries whose slug contains "auth" (case-insensitive) SHALL be shown

#### Scenario: Search filters by name (with groups, composes with pill)
- **WHEN** at least one group is defined, the active pill is `UI`, and the user types `"auth"`
- **THEN** only entries assigned to group `"ui"` whose slug contains `"auth"` SHALL be shown

#### Scenario: Empty search shows all
- **WHEN** the search input is empty
- **THEN** all archived entries within the active pill scope SHALL be displayed (or all entries when pill is "All")

#### Scenario: No results
- **WHEN** the user searches for a term that matches no entries within the active pill scope
- **THEN** a "No matching entries" message SHALL be displayed inside the relevant section(s)

#### Scenario: Date group headers
- **WHEN** entries are displayed
- **THEN** they SHALL be grouped under date headers (e.g., "2026-04-02", "2026-04-01") sorted newest-first
- **AND** when group sections are present, the date headers SHALL render inside each group section

### Requirement: Archive entry artifact navigation
Each archive entry row SHALL display artifact letter buttons (P D S T) that open the artifact reader for that archived change.

#### Scenario: Click artifact letter on archive entry
- **WHEN** the user clicks the "P" button on archived entry `2026-03-27-openspec-artifact-reader`
- **THEN** the artifact reader SHALL open showing the proposal content from `openspec/changes/archive/2026-03-27-openspec-artifact-reader/proposal.md`

#### Scenario: Artifact letters match available artifacts
- **WHEN** an archive entry has only proposal and tasks artifacts
- **THEN** only "P" and "T" letter buttons SHALL be displayed

### Requirement: Two-level navigation
The archive browser SHALL use two-level navigation: the archive list is the first level, and the artifact reader is the second level. Back from the reader returns to the archive list, preserving scroll position and search filter. Back from the archive list returns to the session/default view.

#### Scenario: Back from artifact reader returns to archive list
- **WHEN** the user opens an artifact from the archive browser and clicks Back
- **THEN** the content area SHALL return to the archive browser (not the session list)
- **AND** the search filter and scroll position SHALL be preserved

#### Scenario: Back from archive browser returns to session list
- **WHEN** the user clicks the back button in the archive browser (not inside an artifact reader)
- **THEN** the content area SHALL return to the session/default view (clear `archiveBrowserCwd` state)

### Requirement: Archive browser renders group sections and pill row when groups defined
When the cwd opened in `ArchiveBrowserView` has `groups.length >= 1`, the view SHALL render a pill row above the existing search input plus collapsible group sections in the entry list. The pill row SHALL contain "All" plus one pill per group plus the trailing "Manage groups…" link. Group sections SHALL be ordered by `group.order` with the implicit "Ungrouped" section rendered last. When `groups.length === 0` the view SHALL render exactly as today (flat date-grouped list with the existing search input only).

#### Scenario: Zero groups → unchanged today behavior
- **WHEN** `ArchiveBrowserView` opens for cwd `/project/foo` and `groups.length === 0`
- **THEN** no pill row SHALL render
- **AND** no group section headers SHALL render
- **AND** the entry list SHALL display date-grouped exactly as today

#### Scenario: One+ groups → pill row + group sections
- **WHEN** `ArchiveBrowserView` opens for cwd `/project/foo` and `groups = [{ id: "ui", order: 0 }]`
- **THEN** a pill row SHALL render above the search input with `[All] [UI] [Manage groups…]`
- **AND** the entry list SHALL be partitioned into a `UI` section followed by an `Ungrouped` section

### Requirement: Pill selection narrows archive entries
The pill row SHALL behave identically to the folder section's pill row: "All" shows every archived entry across all groups; selecting a named pill narrows to entries assigned to that group; the implicit Ungrouped pill (when shown) narrows to entries with no assignment. Pill state is local to each `ArchiveBrowserView` instance and resets when the view unmounts.

#### Scenario: Selecting a pill hides other group sections
- **WHEN** the user clicks the `UI` pill in the archive view
- **THEN** only the `UI` section SHALL render
- **AND** the `Ungrouped` section and any other named sections SHALL NOT render

### Requirement: Existing archive search input becomes the unified name-substring filter
The existing `ArchiveBrowserView` search input SHALL act as the name-substring filter when groups are present, composing with the active pill via AND (entry must belong to the selected group AND its name must contain the substring, case-insensitive). The placeholder copy SHALL remain `"Search archived changes..."` (or be updated to clarify it's a name filter; final copy in design.md is descriptive only).

#### Scenario: Search filter composes with pill
- **WHEN** the user types `"auth"` in the search input and the active pill is `UI`
- **THEN** only archive entries assigned to group `"ui"` whose names contain `"auth"` SHALL render

#### Scenario: Search continues to work when zero groups
- **WHEN** `groups.length === 0` and the user types `"auth"`
- **THEN** the search SHALL filter the flat entry list exactly as today

### Requirement: Archive entries carry their group assignment
`ArchiveBrowserView` SHALL read assignments from the same `<cwd>/openspec/groups/groups.json` file as the folder view. Archive entries are matched by their `name` against `assignments` (changeName → groupId). Entries with no entry in `assignments` render in the Ungrouped section.

#### Scenario: Archived change retains its assignment
- **WHEN** change `"add-auth"` was assigned to group `"ui"` before being archived and the archive entry name is `"2026-04-12-add-auth"` derived to slug `"add-auth"`
- **THEN** the archive entry SHALL render in the `UI` section
- **AND** the same assignment SHALL be respected without any migration step

#### Scenario: Hand-archived change with stale assignment falls into Ungrouped if name no longer matches
- **WHEN** an archive entry's resolved name does not appear in `assignments`
- **THEN** the entry SHALL render in the Ungrouped section

### Requirement: Date sub-grouping preserved within group sections
When group sections are rendered, the existing date-grouped layout SHALL apply **inside** each group section (date headers under the group section). Date sort within each group remains newest-first.

#### Scenario: Date headers nested inside group sections
- **WHEN** the `UI` section contains entries archived on `2026-04-02` and `2026-03-30`
- **THEN** the `UI` section body SHALL render two date sub-headers (`2026-04-02` first, then `2026-03-30`) each containing their entries

#### Scenario: Empty group section shows empty-state message
- **WHEN** the active pill is `UI` and the substring filter excludes every entry
- **THEN** the `UI` section body SHALL render `"No matching archived entries in 'UI'"` (or similar copy)

### Requirement: Manage groups link reuses the same manager component
The `"Manage groups…"` link in the pill row SHALL open the same `OpenSpecGroupManager` component used by the folder view, scoped to the same cwd. Closing the manager SHALL leave the archive view's pill / search state unchanged.

#### Scenario: Manage groups opens the same dialog
- **WHEN** the user clicks `"Manage groups…"` in `ArchiveBrowserView` for cwd `/project/foo`
- **THEN** `OpenSpecGroupManager` SHALL open scoped to `/project/foo`
