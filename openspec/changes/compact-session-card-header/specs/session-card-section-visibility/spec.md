## MODIFIED Requirements

### Requirement: Toggleable section set

The system SHALL expose visibility control for these sections.

Session card:
- built-in subcards and lines: `openspec` (OPENSPEC subcard), `openspec-badge` (OpenSpec phase / change / task-progress line, and the mobile attached-proposal chip), `git` (the header git row: worktree pill, branch, PR status, dirty / drift pill; there is no GIT subcard), `process`, `tags` (tags strip), `spawn` (the New session / New worktree session items of the desktop session actions menu, formerly the `+Session` / `+Worktree` buttons);
- plugin subcards: `kb`, `flows`, `memory`, and `status` (the STATUS subcard as a whole);
- per-plugin entries: `badge-<pluginId>` for each plugin contributing to the session-card badge area, and `actionbar-<pluginId>` for each plugin contributing to the `session-card-action-bar` slot (rendered in the session actions menu's PLUGINS group).

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

#### Scenario: Hiding spawn removes the spawn menu items
- **GIVEN** `spawn` is hidden for folder `/a`
- **WHEN** the session actions menu opens for a session in `/a`
- **THEN** neither New session nor New worktree session SHALL render
- **AND** Fork and Resume SHALL be unaffected

#### Scenario: Hiding git removes the header git row
- **GIVEN** `git` is hidden for folder `/a`
- **AND** a worktree session in `/a` has `gitBranch` set and `cwdMissing: true`
- **WHEN** a desktop card renders that session
- **THEN** no `[data-testid="worktree-pill"]`, branch text, `[data-testid="worktree-pr-segment"]` or `[data-testid="git-dirty-pill"]` SHALL render on the card
- **AND** `[data-testid="cwd-gone-pill"]` SHALL still render in the title row

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
- **THEN** the header git row SHALL render (subject to its own render gate)

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
- **THEN** the header git row SHALL NOT render

### Requirement: Server-side persistence and sync

Global defaults and folder overrides SHALL persist in the dashboard preferences file and survive server restarts. Folder keys SHALL be canonicalized with the same folder-key rule used for collapsed folders. Every change SHALL be broadcast as a full snapshot to all connected browsers, and a snapshot SHALL be sent on every browser connect, including when no preference exists (an empty snapshot), so a reconnecting browser replaces stale state. Setting a value to "inherit" SHALL remove the key; a folder with no remaining keys SHALL be removed. Unknown section ids already stored SHALL be preserved on write.

#### Scenario: Change syncs to another browser
- **GIVEN** two browsers connected
- **WHEN** browser A hides `git` for folder `/a`
- **THEN** browser B's cards in `/a` SHALL stop rendering the header git row without reload

#### Scenario: Survives restart
- **GIVEN** folder `/a` override `process = hidden`
- **WHEN** the server restarts and a browser reconnects
- **THEN** the browser SHALL receive the override and cards in `/a` SHALL hide PROCESS

#### Scenario: Reset folder
- **WHEN** the user resets folder `/a` to global
- **THEN** the stored preferences SHALL contain no entry for `/a`

### Requirement: Inline legend menu

Subcard legend titles on the desktop session card SHALL NOT carry an options control. Section visibility SHALL instead be reachable from the session actions menu's VIEW group:
- **Card sections…** navigates to the Session cards page of the session's group folder (`gitWorktree.mainPath` for worktree sessions, per "Worktree sessions resolve against their group folder"). The per-folder Default/Show/Hide controls live there.
- **Card section defaults…** navigates to the global Session cards defaults in Settings. This replaces the former legend action "Hide everywhere".

Neither item SHALL trigger card selection. The controls and semantics on those pages are unchanged. The former legend menu's immediate hide with an Undo toast is retired; changes are made, and reverted, on those pages.

#### Scenario: Hide in folder with undo
- **GIVEN** a session card in `/a` showing the header git row
- **WHEN** the user activates **Card sections…** in that session's actions menu and sets GIT to Hide for `/a`
- **THEN** the git row SHALL disappear from every card in `/a`
- **AND** setting GIT back to Default on that page SHALL restore `/a`'s previous `git` value

#### Scenario: Menu reachable by keyboard
- **WHEN** a desktop session card has keyboard focus and the user presses Shift+F10
- **THEN** the session actions menu SHALL open
- **AND** **Card sections…** SHALL be reachable with the arrow keys and activatable with Enter

#### Scenario: Legend titles have no options control
- **WHEN** a desktop session card renders its OPENSPEC subcard
- **THEN** neither legend SHALL render an options button

#### Scenario: Hide everywhere is reachable through defaults
- **WHEN** the user activates **Card section defaults…** in a session's actions menu and hides GIT globally
- **THEN** the git row SHALL disappear from every session card that has no folder override showing it

#### Scenario: Card sections reachable from the menu
- **GIVEN** a session card in `/a`
- **WHEN** the user activates **Card sections…** in that session's actions menu
- **THEN** the app SHALL navigate to `/a`'s Session cards page
- **AND** the session SHALL NOT become selected as a side effect
