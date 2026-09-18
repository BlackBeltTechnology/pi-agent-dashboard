## ADDED Requirements

### Requirement: Terminal-focused entry activates or creates a terminal tab

The folder-scoped pane SHALL support a terminal-focused entry, requested by the `focus=terminal` search parameter on the folder editor route.

The pane SHALL honour the request only once the live terminal set for the cwd is **known** — an empty set before the terminal snapshot has been applied SHALL NOT be treated as "no terminal exists". Once known, the pane SHALL activate the tab of the most recently created non-ephemeral terminal at that cwd; when no such terminal exists it SHALL create exactly one terminal at the cwd, whose tab the pane's auto-surface then opens active.

The chosen tab SHALL be active regardless of the order in which auto-surface opened the other terminal tabs.

The request SHALL be honoured at most once per terminal-focused entry: on being honoured the `focus=terminal` parameter SHALL be removed from the URL without adding a history entry, so re-renders, terminal-set changes, and pane remounts create no additional terminals and do not override the user's subsequent tab choice. A terminal-focused entry for a different cwd SHALL be honoured even when the pane is not remounted.

Without the parameter the pane's behaviour is unchanged.

#### Scenario: Existing terminal is focused

- **GIVEN** the terminal snapshot has been applied and terminals `t1` (older) and `t2` (newer) exist at `/home/u/proj`
- **WHEN** the folder pane for `/home/u/proj` mounts with `focus=terminal`
- **THEN** `term:t1` and `term:t2` SHALL both be open and `term:t2` SHALL be the active tab
- **AND** no terminal SHALL be created

#### Scenario: No terminal exists, one is created

- **GIVEN** the terminal snapshot has been applied and no non-ephemeral terminal exists at `/home/u/proj`
- **WHEN** the folder pane mounts with `focus=terminal`
- **THEN** exactly one terminal SHALL be created at `/home/u/proj` and its `term:` tab SHALL be active

#### Scenario: Unapplied snapshot does not count as "no terminal"

- **GIVEN** terminals exist at `/home/u/proj` on the server but the terminal snapshot has not yet been applied, so the pane's live terminal set is empty
- **WHEN** the folder pane mounts with `focus=terminal`
- **THEN** no terminal SHALL be created while the set is unknown
- **AND** once the snapshot is applied, the newest existing terminal's tab SHALL be activated and still no terminal SHALL be created

#### Scenario: Re-render does not create a second terminal

- **GIVEN** the pane honoured `focus=terminal` and created `t1`
- **WHEN** the terminal set updates (e.g. `t1`'s title arrives) and the pane re-renders
- **THEN** no second terminal SHALL be created and `term:t1` SHALL stay active

#### Scenario: Remount after consumption does not re-focus

- **GIVEN** the pane honoured `focus=terminal`, the parameter was removed from the URL, and the user then activated a file tab
- **WHEN** the pane unmounts and remounts on the same URL (e.g. an overlay route opens and is dismissed)
- **THEN** the user's file tab SHALL remain active
- **AND** no terminal SHALL be created

#### Scenario: Terminal-focused entry for a different cwd is honoured

- **GIVEN** the pane honoured `focus=terminal` for `/home/u/a`
- **WHEN** the route changes to the folder editor for `/home/u/b` with `focus=terminal` without remounting the pane
- **THEN** the entry SHALL be honoured for `/home/u/b`

#### Scenario: Plain editor entry is unchanged

- **WHEN** the folder pane mounts without `focus=terminal`
- **THEN** existing terminals SHALL auto-surface exactly as they do today, with no change to which tab that leaves active
- **AND** no terminal SHALL be created
