## ADDED Requirements

### Requirement: Terminal-focused entry activates or creates a terminal tab

The folder-scoped pane SHALL support a terminal-focused entry, requested by the `focus=terminal` search parameter on the folder editor route. On such an entry, after the pane has reconciled its `term:` tabs against the live terminals at the cwd, the pane SHALL activate the tab of the most recently created non-ephemeral terminal at that cwd; when no such terminal exists it SHALL create exactly one terminal at the cwd and open its tab active, using the same path as the pane's new-terminal affordance. The request SHALL be honoured at most once per pane mount, so re-renders and terminal-set changes do not create additional terminals. Without the parameter the pane's behaviour is unchanged.

#### Scenario: Existing terminal is focused

- **GIVEN** terminals `t1` (older) and `t2` (newer) exist at `/home/u/proj`
- **WHEN** the folder pane for `/home/u/proj` mounts with `focus=terminal`
- **THEN** `term:t1` and `term:t2` SHALL both be open and `term:t2` SHALL be the active tab
- **AND** no terminal SHALL be created

#### Scenario: No terminal exists, one is created

- **GIVEN** no non-ephemeral terminal exists at `/home/u/proj`
- **WHEN** the folder pane mounts with `focus=terminal`
- **THEN** exactly one terminal SHALL be created at `/home/u/proj` and its `term:` tab SHALL be active

#### Scenario: Re-render does not create a second terminal

- **GIVEN** the pane mounted with `focus=terminal` and created `t1`
- **WHEN** the terminal set updates (e.g. `t1`'s title arrives) and the pane re-renders
- **THEN** no second terminal SHALL be created and `term:t1` SHALL stay active

#### Scenario: Plain editor entry is unchanged

- **WHEN** the folder pane mounts without `focus=terminal`
- **THEN** existing terminals SHALL auto-surface as today, none SHALL be activated by the entry, and none SHALL be created
