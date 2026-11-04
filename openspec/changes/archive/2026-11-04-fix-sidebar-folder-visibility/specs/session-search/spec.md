## MODIFIED Requirements

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
