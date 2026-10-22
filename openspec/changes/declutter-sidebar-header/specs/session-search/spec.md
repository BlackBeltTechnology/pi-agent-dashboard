## MODIFIED Requirements

### Requirement: Sidebar-level Folder filter and Session search inputs

The sidebar header SHALL render one search box with a Sessions/Folders scope toggle that holds two queries: a `Folder…` filter and a `Session…` search. The scope SHALL select which query the box edits; both queries stay applied. They SHALL compose with AND logic as before. A non-empty inactive query SHALL show in the box as a chip of two sibling buttons: one switches to that scope, one clears that query. Queries and scope reset on unmount, and on opening a session from the open-questions panel (which also clears tag filters).

#### Scenario: Both inputs rendered in the sidebar header
- **WHEN** the sidebar renders
- **THEN** the header SHALL contain one search box whose scope toggle offers Sessions and Folders, with Sessions selected by default
- **AND** with scope Sessions the box SHALL edit the `Session…` query, and with scope Folders it SHALL edit the `Folder…` query
- **AND** no search input SHALL appear inside individual folder bodies

#### Scenario: Inputs survive folder collapse
- **WHEN** the user types into the box under either scope and then collapses or expands a folder
- **THEN** both query values SHALL be retained

#### Scenario: AND composition
- **WHEN** the user types `dashboard` with scope Folders, switches to scope Sessions and types `auth`
- **THEN** the sidebar SHALL show only folders whose `cwd` includes `dashboard` AND whose sessions include at least one matching `auth`
- **AND** the box SHALL show `auth` as its editable value and `dashboard` as a folder chip

#### Scenario: Switching scope keeps the other query
- **GIVEN** the `Folder…` query is `dashboard` and the `Session…` query is empty
- **WHEN** the user switches scope from Folders to Sessions
- **THEN** the `Folder…` query SHALL remain `dashboard` and still filter folders
- **AND** the box SHALL be empty and editable for the `Session…` query

#### Scenario: Clearing the inactive query from its chip
- **GIVEN** scope Sessions with the `Folder…` query `dashboard` shown as a chip
- **WHEN** the user activates the chip's clear control
- **THEN** the `Folder…` query SHALL become empty, the chip SHALL disappear, and the `Session…` query SHALL be unchanged

#### Scenario: Chip switches scope
- **GIVEN** scope Sessions with the `Folder…` query `dashboard` shown as a chip
- **WHEN** the user activates the chip's label button
- **THEN** the scope SHALL become Folders and the box SHALL show `dashboard` as its editable value, with no chip

#### Scenario: Opening a question session resets search
- **GIVEN** scope Folders with both queries non-empty
- **WHEN** the user opens a session from the open-questions panel
- **THEN** both queries SHALL be empty, tag filters SHALL be cleared and the scope SHALL be Sessions

### Requirement: Visibility rules for unpinned folders

The default sidebar SHALL show only pinned folders AND any unpinned folder containing at least one alive session (status ≠ "ended"). Unpinned folders containing only ended sessions SHALL be hidden by default. Typing into the search box with scope Folders (the `Folder…` query) SHALL re-include any unpinned folder whose `cwd` matches the filter, regardless of session status.

#### Scenario: Unpinned folder with active session is visible
- **WHEN** an unpinned folder contains at least one session with status ≠ "ended"
- **THEN** that folder SHALL appear in the default sidebar

#### Scenario: Unpinned folder with only ended sessions is hidden by default
- **WHEN** an unpinned folder contains only ended sessions
- **THEN** that folder SHALL NOT appear in the default sidebar

#### Scenario: Folder filter re-includes unpinned-only-ended folders
- **WHEN** the user types a substring matching an unpinned folder's `cwd` with scope Folders
- **THEN** that folder SHALL appear regardless of whether any of its sessions are alive

### Requirement: Session-search-only mode shows pinned folders only

When `Session…` is non-empty AND `Folder…` is empty, the sidebar SHALL show pinned folders only. Unpinned folders SHALL NOT be searched in this mode, even if they contain matching alive sessions. The user opts into cross-cwd search by also entering a `Folder…` query (scope Folders).

#### Scenario: Session search without folder filter limits to pinned
- **WHEN** the user enters a `Session…` query while the `Folder…` query is empty
- **THEN** only pinned folders SHALL be shown
- **AND** unpinned folders SHALL be hidden even if they contain matching sessions

#### Scenario: Folder filter unlocks unpinned matches
- **WHEN** the user enters both a `Folder…` query and a `Session…` query
- **THEN** unpinned folders matching `Folder…` AND containing matching sessions SHALL appear

### Requirement: Auto-expand collapsed folders when a filter is active

While either query is non-empty, all visible folders SHALL be force-expanded so the user can immediately see what matched, regardless of the user's prior collapse state. When both queries become empty, the user's previous collapse state SHALL be restored.

#### Scenario: Auto-expand on filter
- **WHEN** the user types into the search box under either scope
- **THEN** all visible folders SHALL be expanded
- **AND** ended-session subgroups within those folders SHALL also be auto-expanded so search results are visible

#### Scenario: Restore collapse on clear
- **WHEN** the user clears both queries
- **THEN** folders SHALL return to their previous collapse state

### Requirement: Substring match against display name

`Session…` search SHALL filter resident sessions using case-insensitive substring matching against the same string the user sees on the card. The matcher SHALL fall back through the same chain as `getSessionDisplayName`:
1. `name` if non-empty
2. `firstMessage` if no name
3. last segment of `cwd` if neither

Archived sessions SHALL NOT be searched client-side. When the Include archive toggle in the sidebar header's filter funnel is on and the query has at least 3 characters, archived matches SHALL be fetched from the server (name / firstMessage only, no cwd fallback) and rendered per folder under an `Archive matches` section.

#### Scenario: Match against name
- **WHEN** a session has `name = "Refactor auth"` and the user types `auth`
- **THEN** the session SHALL appear in results

#### Scenario: Case-insensitive
- **WHEN** a session has `name = "Refactor Auth"` and the user types `AUTH`
- **THEN** the session SHALL appear in results

#### Scenario: Fallback to firstMessage when no name
- **WHEN** a session has `name = undefined` and `firstMessage = "explore the dashboard server"` and the user types `dashboard`
- **THEN** the session SHALL appear in results

#### Scenario: Fallback to cwd basename when no name and no firstMessage
- **WHEN** a session has `name = null`, `firstMessage = ""`, and `cwd = "/home/user/pi-shodh"` and the user types `pi-sho`
- **THEN** the session SHALL appear in results because its display name is the cwd basename

#### Scenario: Archived sessions excluded unless chip on
- **WHEN** the Include archive toggle is off and the user types text that matches only an archived session
- **THEN** no result SHALL be shown for that session

#### Scenario: Archived matches with chip on
- **WHEN** the Include archive toggle is on and the user types `auth` (≥ 3 chars) matching an archived session's name
- **THEN** that session SHALL appear as an archived row under its folder's `Archive matches` section
