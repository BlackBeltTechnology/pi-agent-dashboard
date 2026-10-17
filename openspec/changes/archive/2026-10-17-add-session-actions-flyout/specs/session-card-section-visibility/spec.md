## MODIFIED Requirements

### Requirement: Toggleable section set

The system SHALL expose visibility control for these sections.

Session card:
- built-in subcards and lines: `openspec` (OPENSPEC subcard), `openspec-badge` (OpenSpec phase / change / task-progress line, and the mobile attached-proposal chip), `git`, `process`, `tags` (tags strip), `spawn` (the New session / New worktree session items of the desktop session actions menu, formerly the `+Session` / `+Worktree` buttons);
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

### Requirement: Inline legend menu

Subcard legend titles on the desktop session card SHALL NOT carry an options control. Section visibility SHALL instead be reachable from the session actions menu's VIEW group:
- **Card sections…** navigates to the Session cards page of the session's group folder (`gitWorktree.mainPath` for worktree sessions, per "Worktree sessions resolve against their group folder"). The per-folder Default/Show/Hide controls live there.
- **Card section defaults…** navigates to the global Session cards defaults in Settings. This replaces the former legend action "Hide everywhere".

Neither item SHALL trigger card selection. The controls and semantics on those pages are unchanged. The former legend menu's immediate hide with an Undo toast is retired; changes are made, and reverted, on those pages.

#### Scenario: Hide in folder with undo
- **GIVEN** a session card in `/a` showing GIT
- **WHEN** the user activates **Card sections…** in that session's actions menu and sets GIT to Hide for `/a`
- **THEN** GIT SHALL disappear from every card in `/a`
- **AND** setting GIT back to Default on that page SHALL restore `/a`'s previous `git` value

#### Scenario: Menu reachable by keyboard
- **WHEN** a desktop session card has keyboard focus and the user presses Shift+F10
- **THEN** the session actions menu SHALL open
- **AND** **Card sections…** SHALL be reachable with the arrow keys and activatable with Enter

#### Scenario: Legend titles have no options control
- **WHEN** a desktop session card renders its OPENSPEC and GIT subcards
- **THEN** neither legend SHALL render an options button

#### Scenario: Hide everywhere is reachable through defaults
- **WHEN** the user activates **Card section defaults…** in a session's actions menu and hides GIT globally
- **THEN** GIT SHALL disappear from every session card that has no folder override showing it

#### Scenario: Card sections reachable from the menu
- **GIVEN** a session card in `/a`
- **WHEN** the user activates **Card sections…** in that session's actions menu
- **THEN** the app SHALL navigate to `/a`'s Session cards page
- **AND** the session SHALL NOT become selected as a side effect
