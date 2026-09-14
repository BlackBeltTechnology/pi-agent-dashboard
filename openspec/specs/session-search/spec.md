# session-search Specification

## Purpose
Describes the sidebar-level two-input search (folder filter + session search) that lets users find specific sessions across pinned workspaces. Composition rules, default-view rules for unpinned folders, and drag-to-resume behavior live here. Display-name fallback (`name` → `firstMessage` → `cwd` basename) keeps "what you see is what you search" consistent with `getSessionDisplayName`.

## Requirements

### Requirement: Sidebar-level Folder filter and Session search inputs

The sidebar header SHALL render two single-line text inputs side-by-side: a `Folder…` filter and a `Session…` search. Both inputs SHALL be uncontrolled, owned by `SessionList` local state, and reset only when the component unmounts. They compose with an AND-logic: when both are non-empty, only folders whose `cwd` matches the folder filter AND that contain at least one session matching the session search are visible.

#### Scenario: Both inputs rendered in the sidebar header
- **WHEN** the sidebar renders
- **THEN** the header SHALL contain a `Folder…` input and a `Session…` input
- **AND** neither input SHALL appear inside individual folder bodies

#### Scenario: Inputs survive folder collapse
- **WHEN** the user types into either input and then collapses or expands a folder
- **THEN** the input value SHALL be retained

#### Scenario: AND composition
- **WHEN** the user types `dashboard` in `Folder…` and `auth` in `Session…`
- **THEN** the sidebar SHALL show only folders whose `cwd` includes `dashboard` AND whose sessions include at least one matching `auth`

### Requirement: Visibility rules for unpinned folders

The default sidebar SHALL show only pinned folders AND any unpinned folder containing at least one alive session (status ≠ "ended"). Unpinned folders containing only ended sessions SHALL be hidden by default. Typing into the `Folder…` input SHALL re-include any unpinned folder whose `cwd` matches the filter, regardless of session status.

#### Scenario: Unpinned folder with active session is visible
- **WHEN** an unpinned folder contains at least one session with status ≠ "ended"
- **THEN** that folder SHALL appear in the default sidebar

#### Scenario: Unpinned folder with only ended sessions is hidden by default
- **WHEN** an unpinned folder contains only ended sessions
- **THEN** that folder SHALL NOT appear in the default sidebar

#### Scenario: Folder filter re-includes unpinned-only-ended folders
- **WHEN** the user types a substring matching an unpinned folder's `cwd` into `Folder…`
- **THEN** that folder SHALL appear regardless of whether any of its sessions are alive

### Requirement: Substring match against display name

`Session…` search SHALL filter resident sessions using case-insensitive substring matching against the same string the user sees on the card. The matcher SHALL fall back through the same chain as `getSessionDisplayName`:
1. `name` if non-empty
2. `firstMessage` if no name
3. last segment of `cwd` if neither

Archived sessions SHALL NOT be searched client-side. When the `include archive` chip is on and the query has at least 3 characters, archived matches SHALL be fetched from the server (name / firstMessage only, no cwd fallback) and rendered per folder under an `Archive matches` section.

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
- **WHEN** the `include archive` chip is off and the user types text that matches only an archived session
- **THEN** no result SHALL be shown for that session

#### Scenario: Archived matches with chip on
- **WHEN** the `include archive` chip is on and the user types `auth` (≥ 3 chars) matching an archived session's name
- **THEN** that session SHALL appear as an archived row under its folder's `Archive matches` section

### Requirement: Session-search-only mode shows pinned folders only

When `Session…` is non-empty AND `Folder…` is empty, the sidebar SHALL show pinned folders only. Unpinned folders SHALL NOT be searched in this mode, even if they contain matching alive sessions. The user opts into cross-cwd search by typing into `Folder…` as well.

#### Scenario: Session search without folder filter limits to pinned
- **WHEN** the user types into `Session…` while `Folder…` is empty
- **THEN** only pinned folders SHALL be shown
- **AND** unpinned folders SHALL be hidden even if they contain matching sessions

#### Scenario: Folder filter unlocks unpinned matches
- **WHEN** the user types into both `Folder…` and `Session…`
- **THEN** unpinned folders matching `Folder…` AND containing matching sessions SHALL appear

### Requirement: Auto-expand collapsed folders when a filter is active

While either input is non-empty, all visible folders SHALL be force-expanded so the user can immediately see what matched, regardless of the user's prior collapse state. When both inputs become empty, the user's previous collapse state SHALL be restored.

#### Scenario: Auto-expand on filter
- **WHEN** the user types into either input
- **THEN** all visible folders SHALL be expanded
- **AND** ended-session subgroups within those folders SHALL also be auto-expanded so search results are visible

#### Scenario: Restore collapse on clear
- **WHEN** the user clears both inputs
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
