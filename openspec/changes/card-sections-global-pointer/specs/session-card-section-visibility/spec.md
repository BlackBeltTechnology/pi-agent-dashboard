## MODIFIED Requirements

### Requirement: Directory Settings "Session cards" page

The directory settings page SHALL include a `Session cards` page (URL page id `cards`) listing each toggleable section with a tri-state control `Global (<inherited value>)` / `Show` / `Hide` (the inherited value is what the row resolves to without its own folder override), grouped as session-card built-in sections, session-card plugin sections, card lines, directory-card sections, and directory-card plugin pills. Overridden rows SHALL be marked. The override summary strip SHALL state that unset sections follow the global defaults and SHALL offer an `Edit global defaults` control that navigates to Settings › General and scrolls the global `Session card sections` block (`data-testid="card-sections-settings"`, a stable anchor) into view; the control SHALL push a history entry, so browser Back returns to the folder page. A `Reset to global` control SHALL be enabled only when the folder has at least one override. Plugin rows (including per-plugin badge, action-bar and pill rows) SHALL render only when an installed plugin contributes to that area. The OPENSPEC and `folder-openspec` rows SHALL state that hiding does not disable OpenSpec and link to the folder's OpenSpec opt-out. A child row whose value is inherited from its legacy parent SHALL show the inherited value in its `Global (…)` label.

#### Scenario: Tri-state writes sparse override
- **GIVEN** global `tags` visible
- **WHEN** the user selects `Hide` on the `tags` row for `/a`, then selects `Global`
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

#### Scenario: Folder page points to the global defaults
- **GIVEN** the Session cards page for `/a`
- **WHEN** the user activates `Edit global defaults`
- **THEN** the app SHALL navigate to Settings › General with the `Session card sections` block scrolled into view
- **AND** browser Back SHALL return to `/a`'s Session cards page

#### Scenario: Inherit option names the global source
- **GIVEN** global `git` hidden and no `/a` override for `git`
- **WHEN** the Session cards page for `/a` renders
- **THEN** the GIT row's inherit option SHALL read `Global (Hide)`

### Requirement: Inline legend menu

Subcard legend titles on the desktop session card SHALL NOT carry an options control. Section visibility SHALL instead be reachable from the session actions menu's VIEW group:
- **Card sections…** navigates to the Session cards page of the session's group folder (`gitWorktree.mainPath` for worktree sessions, per "Worktree sessions resolve against their group folder"). The per-folder Global/Show/Hide controls live there, and its `Edit global defaults` control leads to the global defaults, which replace the former legend action "Hide everywhere".

The item SHALL NOT trigger card selection. The per-folder and global controls keep their semantics; only the inherit option's label changes (`Global (…)`). The former legend menu's immediate hide with an Undo toast is retired; changes are made, and reverted, on those pages.

#### Scenario: Hide in folder with undo
- **GIVEN** a session card in `/a` showing the header git row
- **WHEN** the user activates **Card sections…** in that session's actions menu and sets GIT to Hide for `/a`
- **THEN** the git row SHALL disappear from every card in `/a`
- **AND** setting GIT back to Global on that page SHALL restore `/a`'s previous `git` value

#### Scenario: Menu reachable by keyboard
- **WHEN** a desktop session card has keyboard focus and the user presses Shift+F10
- **THEN** the session actions menu SHALL open
- **AND** **Card sections…** SHALL be reachable with the arrow keys and activatable with Enter

#### Scenario: Legend titles have no options control
- **WHEN** a desktop session card renders its OPENSPEC subcard
- **THEN** neither legend SHALL render an options button

#### Scenario: Hide everywhere is reachable through defaults
- **WHEN** the user activates **Card sections…** in a session's actions menu, then `Edit global defaults`, and hides GIT globally
- **THEN** the git row SHALL disappear from every session card that has no folder override showing it

#### Scenario: Card sections reachable from the menu
- **GIVEN** a session card in `/a`
- **WHEN** the user activates **Card sections…** in that session's actions menu
- **THEN** the app SHALL navigate to `/a`'s Session cards page
- **AND** the session SHALL NOT become selected as a side effect
