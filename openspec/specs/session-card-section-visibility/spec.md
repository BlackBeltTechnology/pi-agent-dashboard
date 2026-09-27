# session-card-section-visibility Specification

## Purpose
Lets users hide session-card sections globally and per folder, with the preference persisted server-side and synced to every browser, so busy sidebars show only the sections a folder actually uses.

## Requirements

### Requirement: Toggleable section set

The system SHALL expose visibility control for exactly these session-card sections: `openspec`, `git`, `process` (built-in subcards); `kb`, `status`, `flows`, `memory` (plugin subcards); `tags` (tags strip) and `spawn` (`+Session` / `+Worktree` buttons). The context usage bar SHALL NOT be part of this set; it remains governed by the existing display preference.

#### Scenario: Context usage bar is not duplicated
- **WHEN** the Session cards settings page renders
- **THEN** no Show/Hide control for the context usage bar SHALL render
- **AND** a link to the display preference that governs it SHALL render

### Requirement: Visibility resolution order

The effective visibility of a section for a session SHALL resolve as: folder override (if set) → global default (if set) → visible. A section resolved as visible SHALL still auto-hide when it has no content, as it does today. A section resolved as hidden SHALL NOT render, regardless of content, except for the PROCESS safety chip.

#### Scenario: No preferences at all
- **GIVEN** no global defaults and no folder overrides exist
- **WHEN** a session card renders
- **THEN** every section SHALL render exactly as before this change

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

### Requirement: Worktree sessions resolve against their group folder

For a session in a git worktree, folder overrides SHALL be looked up by the folder the session is grouped under (the worktree's main checkout path), not the worktree's own cwd.

#### Scenario: Worktree follows main checkout
- **GIVEN** folder `/repo` override `openspec = hidden`
- **AND** a session whose cwd is `/repo/.worktrees/feat` with main path `/repo`
- **WHEN** that session's card renders
- **THEN** the OPENSPEC subcard SHALL NOT render

### Requirement: Server-side persistence and sync

Global defaults and folder overrides SHALL persist in the dashboard preferences file and survive server restarts. Folder keys SHALL be canonicalized with the same folder-key rule used for collapsed folders. Every change SHALL be broadcast as a full snapshot to all connected browsers, and a snapshot SHALL be sent on every browser connect, including when no preference exists (an empty snapshot), so a reconnecting browser replaces stale state. Setting a value to "inherit" SHALL remove the key; a folder with no remaining keys SHALL be removed. Unknown section ids already stored SHALL be preserved on write.

#### Scenario: Change syncs to another browser
- **GIVEN** two browsers connected
- **WHEN** browser A hides `git` for folder `/a`
- **THEN** browser B's cards in `/a` SHALL stop rendering GIT without reload

#### Scenario: Survives restart
- **GIVEN** folder `/a` override `process = hidden`
- **WHEN** the server restarts and a browser reconnects
- **THEN** the browser SHALL receive the override and cards in `/a` SHALL hide PROCESS

#### Scenario: Reset folder
- **WHEN** the user resets folder `/a` to global
- **THEN** the stored preferences SHALL contain no entry for `/a`

### Requirement: Input validation

The server SHALL reject a visibility message whose section id is not 1–64 characters of `[a-z0-9-]`, whose value is not `true`, `false` or `null`, or whose path is empty. The server SHALL cap stored folder entries (at least 1000) and per-map keys (at least 64) and SHALL reject writes past the cap without mutating state.

#### Scenario: Malformed section id rejected
- **WHEN** a browser sends a visibility message with section id `../x`
- **THEN** preferences SHALL NOT change and no broadcast SHALL occur

### Requirement: Directory Settings "Session cards" page

The directory settings page SHALL include a `Session cards` page (URL page id `cards`) listing each toggleable section with a tri-state control `Default (<global value>)` / `Show` / `Hide`, grouped as built-in sections, plugin sections, and card lines. Overridden rows SHALL be marked. A `Reset to global` control SHALL be enabled only when the folder has at least one override. Plugin section rows SHALL render only when an installed plugin contributes to that section. The OPENSPEC row SHALL state that hiding does not disable OpenSpec and link to the folder's OpenSpec opt-out.

#### Scenario: Tri-state writes sparse override
- **GIVEN** global `tags` visible
- **WHEN** the user selects `Hide` on the `tags` row for `/a`, then selects `Default`
- **THEN** after the first action `/a` SHALL store `tags = hidden`
- **AND** after the second action `/a` SHALL store no `tags` key

#### Scenario: Plugin row absent without plugin
- **GIVEN** no plugin contributes to the memory section
- **WHEN** the Session cards page renders
- **THEN** no MEMORY row SHALL render

### Requirement: Global defaults in Settings

Global settings SHALL include a `Session card sections` block with one on/off switch per toggleable section, each showing the number of folders that override that section.

#### Scenario: Override count shown
- **GIVEN** folders `/a` and `/b` override `flows`
- **WHEN** the global block renders
- **THEN** the FLOWS row SHALL indicate 2 folder overrides

### Requirement: Inline legend menu

Each rendered subcard with a legend title SHALL offer a keyboard-accessible options menu on its legend with actions `Hide in this folder`, `Hide everywhere`, and `Section settings…`. Hide actions SHALL apply immediately and show a toast with an Undo action that restores the previous values. `Section settings…` SHALL navigate to the folder's Session cards page. The menu control SHALL NOT trigger card selection.

#### Scenario: Hide in folder with undo
- **GIVEN** a session card in `/a` showing GIT
- **WHEN** the user chooses `Hide in this folder` from the GIT legend menu
- **THEN** GIT SHALL disappear from every card in `/a`
- **AND** choosing Undo in the toast SHALL restore `/a`'s previous `git` value

#### Scenario: Menu reachable by keyboard
- **WHEN** focus moves into a subcard
- **THEN** the legend options control SHALL be focusable and openable with Enter or Space

### Requirement: PROCESS safety chip

When `process` resolves hidden and the session has at least one background process, the card SHALL render a compact warning chip stating the background process count. Activating it SHALL open the process list for that session.

#### Scenario: Hidden PROCESS with running background process
- **GIVEN** `process` hidden for `/a`
- **AND** a session in `/a` has 1 background process
- **WHEN** its card renders
- **THEN** no PROCESS subcard SHALL render
- **AND** a warning chip reading 1 background process SHALL render

#### Scenario: Hidden PROCESS, nothing running
- **GIVEN** `process` hidden and no background processes
- **WHEN** the card renders
- **THEN** no PROCESS subcard and no warning chip SHALL render
