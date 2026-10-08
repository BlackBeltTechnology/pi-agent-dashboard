# focus-mode Specification

## Purpose
Gives users a one-click, minimalist Focus mode that hides distracting blocks and effects across the sidebar via a non-destructive overlay profile, synced to every browser.

## Requirements

### Requirement: Focus mode state and sync

The system SHALL persist, in the dashboard preferences file, a Focus state consisting of `enabled` (boolean, default off) and an optional focus profile. The state SHALL be broadcast to every connected browser on every change and sent on browser connect, as part of the card-section snapshot. Older clients that do not understand the Focus state SHALL keep working with their normal preferences.

#### Scenario: Toggle syncs to another browser
- **GIVEN** two browsers connected and Focus mode off
- **WHEN** browser A turns Focus mode on
- **THEN** browser B SHALL apply Focus mode without reload

#### Scenario: Survives restart
- **GIVEN** Focus mode on
- **WHEN** the server restarts and a browser reconnects
- **THEN** the browser SHALL receive Focus mode on and render accordingly

### Requirement: Focus profile overlay

The focus profile SHALL be a sparse map of section / effect id → visible (boolean) plus an optional `folderListMode`. While Focus mode is on, every id the profile sets SHALL take precedence over folder overrides and global defaults, and a profile `folderListMode` SHALL take precedence over the configured folder list mode. Ids the profile does not set SHALL resolve normally. Turning Focus mode on or off SHALL NOT modify global defaults, folder overrides, effect settings or the configured folder list mode.

#### Scenario: Off restores the normal setup
- **GIVEN** folder `/a` override `git = visible`, global `flows = visible`, and a profile hiding `git` and `flows`
- **WHEN** the user turns Focus mode on and then off
- **THEN** while on, GIT and FLOWS SHALL NOT render in `/a`
- **AND** after turning off, `/a`'s stored override and the global value SHALL be unchanged and GIT and FLOWS SHALL render again

#### Scenario: Unset id falls through
- **GIVEN** Focus mode on and a profile that does not mention `process`
- **WHEN** global `process = visible`
- **THEN** the PROCESS subcard SHALL render (subject to its empty rule)

#### Scenario: Profile switches folder list mode
- **GIVEN** configured folder list mode `classic` and a profile with `folderListMode = accordion`
- **WHEN** Focus mode is on
- **THEN** the sidebar SHALL behave in accordion mode
- **AND** the configured setting SHALL still read `classic`

### Requirement: Built-in default focus profile

When no focus profile is stored, Focus mode SHALL apply a built-in minimalist profile that hides every optional session-card block (`openspec`, `openspec-badge`, `git`, `tags`, `spawn`, `kb`, `status`, `flows`, `memory`, and every per-plugin badge and action-bar entry), every directory-card block (`folder-git`, `folder-banner`, `folder-openspec`, `folder-create`, `folder-ended`, every per-plugin pill), both visual effects, and sets `folderListMode = accordion`. The PROCESS subcard SHALL remain governed by normal resolution. A `Reset to default` action SHALL delete the stored profile.

#### Scenario: Minimal sidebar out of the box
- **GIVEN** no stored focus profile
- **WHEN** the user turns Focus mode on
- **THEN** directory cards SHALL show only their header and session cards
- **AND** session cards SHALL show no subcards other than PROCESS when it has content
- **AND** card status gradients and the selected glow ring SHALL NOT animate

#### Scenario: Safety cues survive
- **GIVEN** Focus mode on with the built-in profile
- **WHEN** a folder requires re-trust and a session with `process` hidden has a background process
- **THEN** the folder banner safety chip and the PROCESS safety chip SHALL render

### Requirement: Save current as focus profile

Settings SHALL offer `Save current as my focus profile`, which stores, for every offered section and effect id, the value that id resolves to with Focus off and no folder override (global default → legacy parent's global default → visible), plus the configured folder list mode. The stored profile is explicit: later changes to global defaults SHALL NOT change it. Settings SHALL also offer per-row editing of the profile with the states `Not set` / `Show` / `Hide` for the same rows as the global block, behind a collapsed `Customize profile` disclosure, and `Reset to default`. The first edit while the built-in profile is in use SHALL first store a copy of the built-in profile's explicit values, then apply the edit.

#### Scenario: Capture current globals
- **GIVEN** global `git = hidden`, `flows = visible` and folder list mode `classic`
- **WHEN** the user chooses `Save current as my focus profile`
- **THEN** the stored profile SHALL contain `git = hidden`, `flows = visible` and `folderListMode = classic`

#### Scenario: Parent-derived value captured explicitly
- **GIVEN** global `openspec = hidden` and no global value for `openspec-badge`
- **WHEN** the user chooses `Save current as my focus profile`
- **THEN** the stored profile SHALL contain `openspec-badge = hidden`

#### Scenario: Edit one profile row
- **GIVEN** a stored custom profile
- **WHEN** the user sets the profile row `badge-automation` to `Show`
- **THEN** the stored profile SHALL contain `badge-automation = visible` and no other key SHALL change

#### Scenario: First edit copies the built-in profile
- **GIVEN** no stored profile (built-in in use)
- **WHEN** the user sets the profile row `badge-goal` to `Show`
- **THEN** a custom profile SHALL be stored that equals the built-in profile's explicit values for every offered id, with `badge-goal = visible`, and `folderListMode = accordion`
- **AND** the profile label SHALL change from built-in to custom

### Requirement: Focus notice on settings pages

While Focus mode is on, the global card-blocks settings, the directory Session cards page and the Effects settings SHALL show a notice stating that Focus is on, that the page shows the user's normal settings, and a `Turn off Focus` action.

#### Scenario: Notice explains a muted change
- **GIVEN** Focus mode on with the built-in profile
- **WHEN** the user opens the global card-blocks settings
- **THEN** a notice stating Focus is on SHALL render with a `Turn off Focus` action
- **AND** activating it SHALL turn Focus mode off

#### Scenario: No notice when off
- **GIVEN** Focus mode off
- **WHEN** any of those settings pages renders
- **THEN** no Focus notice SHALL render

### Requirement: Focus toggle entry points

Focus mode SHALL be toggleable from a control in the sidebar header and from Settings. The sidebar control SHALL be a keyboard-operable toggle button exposing its pressed state to assistive technology, and SHALL be visibly marked while Focus mode is on.

#### Scenario: Sidebar toggle
- **WHEN** the user activates the sidebar Focus control with Enter or Space
- **THEN** Focus mode SHALL toggle
- **AND** the control SHALL report its pressed state

### Requirement: Focus state validation

The server SHALL reject a Focus message whose `enabled` is not a boolean, whose profile contains an id failing the section-id rule, a value other than boolean, a `folderListMode` other than `classic` / `accordion`, or more than 256 profile keys — without mutating state and without broadcasting.

#### Scenario: Malformed profile rejected
- **WHEN** a browser sends a focus profile containing id `../x`
- **THEN** the stored Focus state SHALL NOT change and no broadcast SHALL occur
