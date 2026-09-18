## REMOVED Requirements

### Requirement: Collapse state persistence
**Reason**: Superseded by "Server-side folder collapse persistence" below. The
localStorage regime is replaced by the server-side preferences regime, and its
"Prune stale collapsed entries" scenario is the defect this change fixes — the
prune deletes live state for every folder group whose key is not some loaded
session's raw `cwd`.

**Migration**: A legacy `dashboard:collapsedGroups` localStorage value is
uploaded once to the server and then deleted; see the one-shot migration
scenario below. No user action required.

## ADDED Requirements

### Requirement: Server-side folder collapse persistence
The collapsed/expanded state of folder groups SHALL be persisted server-side in
the global preferences file, keyed by a canonicalized directory path. The state
SHALL therefore survive a page reload, a cache clear, a different browser
profile, and a different device, in the same way workspace collapse state
already does.

The system SHALL NOT remove a persisted collapsed folder key on the grounds
that no currently loaded session matches it. A folder group may be rendered
from a worktree main path, a pinned directory with zero sessions, an
ended-only stub, or a workspace folder membership — none of which appear among
the loaded sessions' working directories, so any such removal deletes live
state.

#### Scenario: Persist collapse
- **WHEN** a user collapses a folder group
- **THEN** the collapsed state SHALL be sent to the server and stored in the global preferences file

#### Scenario: Expand after reload
- **WHEN** a user reloads the page with a previously collapsed group
- **THEN** the group SHALL render in collapsed state

#### Scenario: State shared across browsers and devices
- **WHEN** a user collapses a folder group in one browser and then opens the dashboard in a different browser or on a different device
- **THEN** that folder group SHALL render collapsed there as well

#### Scenario: Collapsed folder with no loaded sessions survives a session update
- **WHEN** a collapsed folder group has no loaded session whose working directory equals its group key — because it is a worktree group, a pinned directory with zero sessions, an ended-only folder, or a workspace folder — and the set of loaded sessions subsequently changes
- **THEN** its collapsed state SHALL be retained, and the folder SHALL still render collapsed after a reload

#### Scenario: State available on first paint after reload
- **WHEN** a browser client connects and the user has previously collapsed folders
- **THEN** the collapsed state SHALL be delivered as part of the client's initial state, so collapsed folders do not first render expanded and then correct themselves

#### Scenario: One-shot migration of legacy client-side state
- **WHEN** the dashboard loads and a legacy browser-local collapsed-folders value from before this change is present
- **THEN** those folders SHALL be added to the stored set without discarding folders already collapsed server-side, the legacy browser-local value SHALL be deleted once storage is confirmed, and the migration SHALL NOT run again on subsequent loads

#### Scenario: Migration survives an interrupted connection
- **WHEN** the legacy value cannot be confirmed as stored because the connection is interrupted
- **THEN** the legacy browser-local value SHALL be retained and the migration SHALL be retried on a later load

### Requirement: Canonical folder collapse keys
Folder collapse keys SHALL be canonicalized with the same path-key rule the
system uses elsewhere for folder identity, on both write and read, and the
client and the server SHALL derive that key identically for the same path. A
folder addressed by a worktree main path, by a pinned-directory string, by an
ended-only stub path, or by a live session's working directory SHALL resolve to
one and the same collapse key when those paths normalize to the same path.

This key rule is textual normalization only. Two paths that reach the same
directory through a symbolic link are NOT required to share a collapse key,
because the browser cannot resolve links; such paths already render as separate
folder groups, and each group keeps its own collapse state.

#### Scenario: Same folder reached by different path spellings
- **WHEN** a folder group's path differs from the stored collapsed key only by trailing separator or by separator style
- **THEN** the group SHALL be recognised as collapsed

#### Scenario: Worktree group collapse round-trips
- **WHEN** a user collapses a folder group whose sessions live in git worktrees and the group is keyed by the worktree main path
- **THEN** the collapsed state SHALL be stored under the canonicalized main path and the group SHALL render collapsed after a reload

#### Scenario: Client and server agree on the key for the same folder
- **WHEN** a folder is collapsed on any supported operating system
- **THEN** the key the client uses to ask "is this folder collapsed" SHALL equal the key the stored state is recorded under, so the folder renders collapsed on the next load

#### Scenario: Expanding to spawn into a collapsed folder
- **WHEN** a user starts a new session or worktree from a collapsed folder's header
- **THEN** that folder SHALL end up expanded, and SHALL NOT be re-collapsed by a second such action issued before the first is acknowledged

#### Scenario: Revealing a folder never collapses it
- **WHEN** the system reveals a target inside a folder group twice in quick succession, including before any earlier reveal has been acknowledged
- **THEN** the folder SHALL end up expanded both times and SHALL NOT be collapsed by the second reveal

#### Scenario: Revealing a worktree-backed target expands the rendered group
- **WHEN** the system reveals a target whose session lives in a git worktree and whose rendered folder group is keyed by the worktree main path
- **THEN** the rendered group SHALL expand

#### Scenario: Toggling is idempotent across spellings
- **WHEN** a folder is collapsed under one path spelling and later expanded under another spelling of the same directory
- **THEN** exactly one collapse entry SHALL be affected and the folder SHALL render expanded
