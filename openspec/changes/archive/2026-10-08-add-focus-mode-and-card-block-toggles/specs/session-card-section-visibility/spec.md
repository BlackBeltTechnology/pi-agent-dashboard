## MODIFIED Requirements

### Requirement: Toggleable section set

The system SHALL expose visibility control for these sections.

Session card:
- built-in subcards and lines: `openspec` (OPENSPEC subcard), `openspec-badge` (OpenSpec phase / change / task-progress line, and the mobile attached-proposal chip), `git`, `process`, `tags` (tags strip), `spawn` (`+Session` / `+Worktree` buttons);
- plugin subcards: `kb`, `flows`, `memory`, and `status` (the STATUS subcard as a whole);
- per-plugin entries: `badge-<pluginId>` for each plugin contributing to the session-card badge area, and `actionbar-<pluginId>` for each plugin contributing to the session-card footer.

Directory (folder) card: `folder-git`, `folder-banner`, `folder-openspec`, `folder-create`, `folder-ended`, and `pill-<pluginId>` for each plugin contributing a folder pill.

Per-plugin ids SHALL be formed from the contributing plugin's id and SHALL satisfy the section-id validation rule; a plugin whose derived id would be invalid SHALL NOT get a switch and its contribution SHALL stay visible.

The context usage bar SHALL NOT be part of this set; it remains governed by the existing display preference.

#### Scenario: Context usage bar is not duplicated
- **WHEN** the Session cards settings page renders
- **THEN** no Show/Hide control for the context usage bar SHALL render
- **AND** a link to the display preference that governs it SHALL render

#### Scenario: Per-plugin badge switch
- **GIVEN** the automation and goal plugins both contribute session-card badges
- **WHEN** the user hides `badge-automation` globally
- **THEN** automation badges SHALL NOT render on any session card
- **AND** goal badges SHALL still render

#### Scenario: Hide the automations folder pill
- **GIVEN** the automation plugin contributes a folder pill
- **WHEN** the user hides `pill-automation` for folder `/a`
- **THEN** the Automations pill SHALL NOT render on `/a`'s directory card
- **AND** the other folder pills on `/a` SHALL still render

### Requirement: Visibility resolution order

The effective visibility of a section SHALL resolve as: focus profile value (only while Focus mode is on, and only if the profile sets it) → folder override (if set) → global default (if set) → legacy parent value (if the id has a parent and the parent resolves through folder override or global default) → visible.

Legacy parents: `openspec-badge` → `openspec`; every `badge-<pluginId>` → `status`. Session-card sections resolve against the session's group folder; directory-card sections resolve against the folder the card represents.

A section resolved as visible SHALL still auto-hide when it has no content, as it does today. A section resolved as hidden SHALL NOT render, regardless of content, except for the PROCESS safety chip and the folder banner safety chip.

#### Scenario: No preferences at all
- **GIVEN** no global defaults, no folder overrides and Focus mode off
- **WHEN** a session card or directory card renders
- **THEN** every section SHALL render exactly as before this change, except that the tags strip SHALL NOT repeat the OpenSpec phase

#### Scenario: Global hide applies to folders without override
- **GIVEN** global default `flows = hidden` and folder `/a` has no override for `flows`
- **WHEN** a session in `/a` with an active flow renders
- **THEN** the FLOWS subcard SHALL NOT render

#### Scenario: Folder override beats global
- **GIVEN** global default `git = hidden` and folder `/a` override `git = visible`
- **WHEN** a session in `/a` renders
- **THEN** the GIT subcard SHALL render (subject to its own empty rule)

#### Scenario: Visible but empty still hides
- **GIVEN** `memory` resolves visible and no plugin claims the memory slot
- **WHEN** a session card renders
- **THEN** no MEMORY subcard SHALL render

#### Scenario: Legacy parent preserved
- **GIVEN** a stored global `openspec = hidden` written before this change and no value for `openspec-badge`
- **WHEN** a session with an OpenSpec phase renders
- **THEN** neither the OPENSPEC subcard nor the OpenSpec badge line SHALL render

#### Scenario: Child overrides parent
- **GIVEN** global `openspec = hidden` and global `openspec-badge = visible`
- **WHEN** a session with an attached change renders
- **THEN** the OpenSpec badge line SHALL render
- **AND** the OPENSPEC subcard SHALL NOT render

#### Scenario: Focus profile beats folder override
- **GIVEN** Focus mode on with profile `git = hidden` and folder `/a` override `git = visible`
- **WHEN** a session in `/a` renders
- **THEN** the GIT subcard SHALL NOT render

### Requirement: Directory Settings "Session cards" page

The directory settings page SHALL include a `Session cards` page (URL page id `cards`) listing each toggleable section with a tri-state control `Default (<global value>)` / `Show` / `Hide`, grouped as session-card built-in sections, session-card plugin sections, card lines, directory-card sections, and directory-card plugin pills. Overridden rows SHALL be marked. A `Reset to global` control SHALL be enabled only when the folder has at least one override. Plugin rows (including per-plugin badge, action-bar and pill rows) SHALL render only when an installed plugin contributes to that area. The OPENSPEC and `folder-openspec` rows SHALL state that hiding does not disable OpenSpec and link to the folder's OpenSpec opt-out. A child row whose value is inherited from its legacy parent SHALL show the inherited value in its `Default (…)` label.

#### Scenario: Tri-state writes sparse override
- **GIVEN** global `tags` visible
- **WHEN** the user selects `Hide` on the `tags` row for `/a`, then selects `Default`
- **THEN** after the first action `/a` SHALL store `tags = hidden`
- **AND** after the second action `/a` SHALL store no `tags` key

#### Scenario: Plugin row absent without plugin
- **GIVEN** no plugin contributes to the memory section
- **WHEN** the Session cards page renders
- **THEN** no MEMORY row SHALL render

#### Scenario: Directory-card rows listed
- **GIVEN** the automation plugin contributes a folder pill
- **WHEN** the Session cards page renders for `/a`
- **THEN** a Directory card group SHALL list git row, setup banner, OpenSpec pill, Create buttons, ended row and an Automations pill row

### Requirement: Global defaults in Settings

Global settings SHALL include a `Session card sections` block with one on/off switch per toggleable section — session-card sections, per-plugin entries, and directory-card sections, grouped the same way as the directory page — each showing the number of folders that override that section.

#### Scenario: Override count shown
- **GIVEN** folders `/a` and `/b` override `flows`
- **WHEN** the global block renders
- **THEN** the FLOWS row SHALL indicate 2 folder overrides

#### Scenario: Directory-card switch applies everywhere
- **GIVEN** no folder overrides `folder-create`
- **WHEN** the user switches `folder-create` off in the global block
- **THEN** no directory card SHALL render the CREATE divider or its spawn buttons

## ADDED Requirements

### Requirement: Directory card blocks honor visibility

Each expanded directory card SHALL omit every block whose section resolves hidden for that folder: `folder-git` (branch / dirty row; the group-by chip on that row SHALL still render), `folder-banner`, `folder-openspec`, each `pill-<pluginId>`, `folder-create` (the CREATE divider, the spawn buttons, and the SESSIONS divider), and `folder-ended`. The folder header (name, status, actions menu) and the session cards SHALL always render. Hidden blocks SHALL leave no empty grid cells or dividers.

#### Scenario: Minimal directory card
- **GIVEN** every directory-card section hidden for `/a`, and `/a` needs no setup
- **WHEN** `/a` is expanded
- **THEN** only the folder header and `/a`'s session cards SHALL render

#### Scenario: Ended row hidden
- **GIVEN** `folder-ended` hidden for `/a` and `/a` has ended sessions
- **WHEN** `/a` renders
- **THEN** no ended-sessions expander SHALL render for `/a`

### Requirement: Folder banner safety chip

When `folder-banner` resolves hidden and the folder is in a state that would show the setup / initialize / re-trust / failure banner, the directory card SHALL render a compact warning chip naming the state. Activating it SHALL reveal the full banner for that folder until the folder leaves that state.

#### Scenario: Hidden banner, folder blocked
- **GIVEN** `folder-banner` hidden and folder `/a` requires re-trust
- **WHEN** `/a` renders
- **THEN** a compact warning chip SHALL render instead of the banner
- **AND** activating the chip SHALL show the full banner

#### Scenario: Hidden banner, folder healthy
- **GIVEN** `folder-banner` hidden and folder `/a` needs no action
- **WHEN** `/a` renders
- **THEN** neither banner nor chip SHALL render

### Requirement: OpenSpec phase shown once

The session card tags strip SHALL render only user tags; the OpenSpec phase SHALL be shown only by the `openspec-badge` line.

#### Scenario: Phase without tags
- **GIVEN** a session with an OpenSpec phase and no user tags, `openspec-badge` and `tags` visible
- **WHEN** its card renders
- **THEN** the phase SHALL appear once, in the OpenSpec badge line
- **AND** no tags strip SHALL render

#### Scenario: Hiding OpenSpec removes the phase entirely
- **GIVEN** `openspec` and `openspec-badge` hidden and `tags` visible
- **WHEN** a session with an OpenSpec phase and one user tag renders
- **THEN** the tags strip SHALL show the user tag only
