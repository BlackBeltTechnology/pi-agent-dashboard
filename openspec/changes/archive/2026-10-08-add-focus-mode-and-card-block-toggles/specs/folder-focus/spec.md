## Purpose

Defines the opt-in accordion folder list: one focused folder renders in full while unfocused folders compact to their header plus only the sessions that need attention, so many folders can be scanned at once.

## ADDED Requirements

### Requirement: Folder list mode setting

The dashboard SHALL expose a global setting `folderListMode` with values `classic` and `accordion`, persisted in the server config and defaulting to `classic`, and a setting `folderAttentionPeek` defaulting to on. An unrecognized persisted `folderListMode` SHALL be read as `classic`. The effective mode SHALL be the focus profile's `folderListMode` while Focus mode is on and the profile sets it, otherwise the configured value.

In `classic` mode folder-list behavior (which folders expand, header and chevron clicks, which session cards a folder lists) SHALL be exactly as before this change; block-level visibility changes from `session-card-section-visibility` still apply. In `accordion` mode the requirements below SHALL apply.

#### Scenario: Classic is the default
- **WHEN** no `folderListMode` is persisted
- **THEN** the effective mode SHALL be `classic` and folders SHALL follow only their persisted collapsed state

#### Scenario: Unknown mode falls back to classic
- **WHEN** the persisted `folderListMode` is an unrecognized string
- **THEN** the effective mode SHALL be `classic`

#### Scenario: Attention peek off
- **GIVEN** accordion mode and `folderAttentionPeek` off
- **WHEN** an unfocused folder that is not pinned open has a streaming session
- **THEN** the folder SHALL render in compact-empty form

### Requirement: Active folder derivation

In accordion mode at most one folder SHALL be focused. The focused folder SHALL follow the user's latest intent: when the most recent of {selecting a session, activating a folder's header body or compact row} was a session selection, the focused folder SHALL be that session's group folder; when it was a folder activation, it SHALL be that folder; with neither, none. The activated folder SHALL be held per browser tab and not persisted; it SHALL be cleared when that folder no longer renders.

#### Scenario: Selection sets the focused folder
- **WHEN** a session in folder `/foo` is selected
- **THEN** `/foo` SHALL be the focused folder

#### Scenario: Latest intent wins over an earlier selection
- **GIVEN** a session in `/foo` is selected
- **WHEN** the user activates the header body of `/bar`
- **THEN** `/bar` SHALL be the focused folder
- **AND** the session in `/foo` SHALL stay selected

#### Scenario: Selecting again refocuses
- **GIVEN** `/bar` focused by a header activation and a session in `/foo` selected earlier
- **WHEN** the user selects a session in `/foo`
- **THEN** `/foo` SHALL be the focused folder

#### Scenario: Header click when nothing selected
- **GIVEN** no session is selected
- **WHEN** the user activates the header body of `/bar`
- **THEN** `/bar` SHALL be the focused folder

#### Scenario: Worktree session focuses its group folder
- **WHEN** a session whose cwd is `/repo/.worktrees/feat` with main path `/repo` is selected
- **THEN** `/repo` SHALL be the focused folder

### Requirement: Pinned-open folders

In accordion mode the user SHALL be able to pin a folder open so it renders in full even when unfocused. The pinned-open set SHALL persist server-side in the global preferences file keyed by the canonical folder key used for collapsed folders, and SHALL sync to every browser. A pinned-open entry SHALL NOT be removed because no loaded session matches it. Pinning a folder open SHALL clear its collapsed state, and collapsing a folder SHALL clear its pin, so a folder is never both pinned open and collapsed. The pinned-open set SHALL have no effect in classic mode.

#### Scenario: Pinned-open folder stays open
- **GIVEN** `/foo` pinned open and `/bar` focused
- **WHEN** the sidebar renders
- **THEN** `/foo` SHALL render all its session cards

#### Scenario: Collapsing clears the pin
- **GIVEN** `/foo` pinned open and focused
- **WHEN** the user collapses `/foo` with its chevron
- **THEN** `/foo` SHALL be collapsed and no longer pinned open

#### Scenario: Survives reload on another device
- **GIVEN** `/foo` pinned open in browser A
- **WHEN** browser B loads the dashboard
- **THEN** `/foo` SHALL be pinned open in browser B

### Requirement: Render-mode resolution

In accordion mode each folder SHALL render in one of four modes. "Has attention" is true only when `folderAttentionPeek` is on AND at least one of the folder's visible sessions needs attention (see `session-filtering`).

| focused | collapsed | pinned open | has attention | mode |
|---|---|---|---|---|
| any | any | yes | any | full |
| yes | no | no | any | full |
| yes | yes | no | any | collapsed |
| no | any | no | yes | compact with attention |
| no | any | no | no | compact empty |

`full` and `collapsed` SHALL render as an expanded or collapsed folder does in classic mode. Both compact modes SHALL render the condensed folder header (as a collapsed folder) followed by the compact body defined by `session-filtering`. While a session search or workspace filter is active, every folder with matches SHALL render `full`.

#### Scenario: Pinned open wins
- **GIVEN** `/foo` pinned open, unfocused and collapsed
- **THEN** `/foo` SHALL render `full`

#### Scenario: Unfocused without attention
- **GIVEN** `/foo` unfocused, not pinned open, no session needing attention
- **THEN** `/foo` SHALL render the condensed header and the compact-empty body

#### Scenario: Search forces full
- **GIVEN** an active session search matching a session in unfocused `/foo`
- **THEN** `/foo` SHALL render `full`
