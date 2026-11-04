# session-search Specification

## Purpose
Describes the sidebar-level two-input search (folder filter + session search) that lets users find specific sessions across pinned workspaces. Composition rules, default-view rules for unpinned folders, and drag-to-resume behavior live here. Display-name fallback (`name` → `firstMessage` → `cwd` basename) keeps "what you see is what you search" consistent with `getSessionDisplayName`.

## Requirements

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

The default sidebar SHALL show pinned folders, workspace folders (membership and placement are defined by `folder-workspaces`), AND any unpinned folder containing at least one alive session (status ≠ "ended", `hidden` sessions not counted while show-hidden is off) or, while no folder filter, tag or phase filter, or Session search (archive search included) is active, the selected session. Unpinned folders containing only ended sessions SHALL be hidden by default, whether or not those sessions are archived. Typing into the search box with scope Folders (the `Folder…` query) SHALL re-include any unpinned folder whose `cwd` matches the filter, regardless of session status. While a tag or phase filter is active, an unpinned folder SHALL appear only when at least one of its sessions, ended included, passes every active filter; a tag or phase filter SHALL NOT reveal a folder that holds no session (a stub group). An unpinned folder with archive-search matches SHALL stay visible so its `Archive matches` section is reachable.

#### Scenario: Unpinned folder with active session is visible
- **WHEN** an unpinned folder contains at least one session with status ≠ "ended"
- **THEN** that folder SHALL appear in the default sidebar

#### Scenario: Unpinned folder with only ended sessions is hidden by default
- **WHEN** an unpinned folder contains only ended sessions
- **THEN** that folder SHALL NOT appear in the default sidebar

#### Scenario: Folder filter re-includes unpinned-only-ended folders
- **WHEN** the user types a substring matching an unpinned folder's `cwd` with scope Folders
- **THEN** that folder SHALL appear regardless of whether any of its sessions are alive

#### Scenario: Unarchived ended sessions do not keep an unpinned folder visible
- **GIVEN** an unpinned folder outside every workspace whose sessions are all ended and none archived, so the snapshot reports a non-zero ended total for it
- **WHEN** the sidebar renders with no folder or tag filter
- **THEN** that folder SHALL NOT appear
- **AND** archiving its sessions SHALL NOT be required for it to disappear

#### Scenario: Last alive session ending hides an unpinned folder
- **GIVEN** an unpinned folder with one alive session and no selected session in it
- **WHEN** that session ends
- **THEN** the folder SHALL leave the default sidebar

#### Scenario: Pinned and workspace folders keep their ended expander
- **GIVEN** a pinned folder, and a workspace folder, each with only ended sessions
- **WHEN** the sidebar renders with no filter
- **THEN** both folders SHALL appear with their ended expander

#### Scenario: Folder holding the selected session stays visible
- **GIVEN** an unpinned folder whose sessions are all ended and one of them is selected, with no folder or tag filter active
- **WHEN** the sidebar renders
- **THEN** the folder SHALL appear
- **AND** when the selection moves to a session in another folder, or is cleared, the folder SHALL leave the default sidebar

#### Scenario: The selected session does not reveal a folder during Session search
- **GIVEN** an unpinned folder whose sessions are all ended and one of them is selected
- **WHEN** the user types a `Session…` query (with no `Folder…` query and no tag filter)
- **THEN** the folder SHALL NOT appear on account of the selected session

#### Scenario: Archive search does not reveal a folder through the selected session
- **GIVEN** an unpinned folder whose sessions are all ended and one of them is selected, and an archive search (a `Session…` query) is active with no archive match in that folder
- **WHEN** the sidebar renders
- **THEN** the folder SHALL NOT appear on account of the selected session
- **AND** an archive match in that folder SHALL still keep it visible

#### Scenario: A hidden alive session does not keep an unpinned folder visible
- **GIVEN** an unpinned folder whose only non-ended session is `hidden`, with show-hidden off
- **WHEN** the sidebar renders with no filter
- **THEN** the folder SHALL NOT appear

#### Scenario: A hidden selected session does not keep its folder visible
- **GIVEN** an unpinned folder whose only session is `hidden` and selected, with show-hidden off
- **WHEN** the sidebar renders
- **THEN** the folder SHALL NOT appear

#### Scenario: A tag filter reveals an ended-only folder only through a matching session
- **GIVEN** an unpinned folder with only ended sessions, one of which passes the active tag filter, and another unpinned folder with only an ended-total stub and no held session
- **WHEN** the sidebar renders with that tag filter active
- **THEN** the first folder SHALL appear
- **AND** the stub-only folder SHALL NOT appear

#### Scenario: Sidebar with no visible folder shows the empty message
- **GIVEN** no pinned folders, no workspaces, and every unpinned folder hidden under these rules
- **WHEN** the sidebar renders
- **THEN** the "No active sessions" message SHALL be shown instead of a blank list

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

### Requirement: Empty-state when no sessions match

When `Session…` is non-empty and a folder has zero matching sessions, the folder body SHALL render the text "No sessions match your search" in place of the session list.

#### Scenario: No matches in folder
- **WHEN** the user types a query and a visible folder has no matching sessions
- **THEN** the folder body SHALL display "No sessions match your search"

### Requirement: Drag-to-resume an ended session

When the user drags an ended session card onto an alive session card within the same folder, the system SHALL (a) write the new drag-reorder position via the existing `reorder_sessions` flow AND (b) dispatch a `resume_session` action in `continue` mode for the ended session. The dropped position SHALL persist through the resume round-trip so the resumed session appears at the dragged location.

#### Scenario: Drop ended onto alive triggers resume
- **WHEN** the user drags an ended session card onto an alive session card in the same folder
- **THEN** `resume_session` SHALL be dispatched with `mode = "continue"` for the ended session
- **AND** the drag-reorder position SHALL be persisted

#### Scenario: Drop ended onto ended is plain reorder
- **WHEN** the user drags an ended session onto another ended session
- **THEN** only `reorder_sessions` SHALL be dispatched (no resume)

#### Scenario: Drop alive onto alive is plain reorder
- **WHEN** the user drags an alive session onto another alive session
- **THEN** only `reorder_sessions` SHALL be dispatched (no resume)
