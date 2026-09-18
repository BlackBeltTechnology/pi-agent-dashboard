# terminal-viewer-tab Specification

## Purpose
TBD - created by archiving change terminals-in-tabbed-panes. Update Purpose after archive.

## Requirements

### Requirement: Terminal SHALL be hosted as an editor-pane tab

A terminal SHALL open as a virtual tab in the editor pane, identified by path `term:<terminalId>` with viewer kind `terminal`. The tab SHALL be created via the pane state reducer's `openFile` action (deduped by path, mirroring `live:<url>` / `diff:<path>`), rendered by the `terminal` entry in `viewer-registry` wrapping `TerminalView`. The terminal tab SHALL NOT fetch file content and SHALL NOT create a file-tree row.

#### Scenario: Opening a terminal creates a terminal tab

- **WHEN** a terminal with id `t1` is opened in a pane
- **THEN** a tab with path `term:t1` and viewer kind `terminal` SHALL appear and become active
- **AND** it SHALL render an attached `TerminalView` for `t1` that fills the tab body

#### Scenario: Opening the same terminal twice is idempotent

- **GIVEN** a pane already has a `term:t1` tab
- **WHEN** `t1` is opened again
- **THEN** the existing `term:t1` tab SHALL be activated, not duplicated

### Requirement: Terminal tabs SHALL scope to the pane cwd

A pane SHALL only host terminals whose `cwd` equals the pane's cwd (session cwd for the session split, folder cwd for the folder pane). Ephemeral terminals (inline `!!` chat cards) SHALL NEVER appear as pane tabs.

#### Scenario: Cross-cwd terminals excluded

- **GIVEN** a pane rooted at `/home/u/a` and a terminal whose cwd is `/home/u/b`
- **THEN** that terminal SHALL NOT be surfaced as a tab in the pane

#### Scenario: Ephemeral terminals excluded

- **GIVEN** an ephemeral terminal exists for the pane cwd
- **THEN** it SHALL NOT appear as a pane tab (it remains an inline chat card)

### Requirement: Terminal tab lifecycle — create, activate, rename, close

The pane SHALL expose a new-terminal affordance that creates a terminal at the pane cwd and opens its tab active. Renaming a terminal tab SHALL call the existing rename handler; closing a terminal tab (`×` / middle-click) SHALL kill the terminal and activate an adjacent tab. Switching away from a terminal tab SHALL keep the terminal alive (keep-alive), and there SHALL be at most one mounted `TerminalView` per terminal id within a pane.

#### Scenario: Create from the pane

- **WHEN** the user activates the pane's new-terminal control
- **THEN** a terminal SHALL be created at the pane cwd and its `term:<id>` tab SHALL open active

#### Scenario: Close kills the terminal

- **WHEN** the user closes a `term:<id>` tab
- **THEN** the terminal `<id>` SHALL be killed
- **AND** an adjacent tab SHALL become active

#### Scenario: Switching tabs keeps the terminal alive

- **GIVEN** a `term:t1` tab and a file tab
- **WHEN** the user switches to the file tab and back
- **THEN** the `t1` session SHALL remain attached (not re-spawned)

### Requirement: Folder pane auto-surfaces cwd terminals; session split is opt-in

The folder-scoped pane SHALL auto-open a `term:<id>` tab for every non-ephemeral terminal at its cwd on mount and when the terminal set changes (replacing the standalone terminals view). The session split SHALL open terminal tabs only on explicit user action, not auto-surface them.

#### Scenario: Folder pane shows all its terminals

- **GIVEN** two non-ephemeral terminals exist at `/home/u/proj`
- **WHEN** the folder pane for `/home/u/proj` mounts
- **THEN** both SHALL appear as `term:` tabs

#### Scenario: Session split does not auto-surface

- **GIVEN** a non-ephemeral terminal exists at the session cwd
- **WHEN** the session split opens
- **THEN** no terminal tab SHALL appear until the user creates/opens one

### Requirement: Persisted terminal tabs SHALL reconcile against live terminals

Persisted pane state MAY include `term:<id>` tabs; the pane-state validator SHALL accept the `terminal` viewer kind. On load, the pane SHALL drop any `term:<id>` tab whose id is not present in the current terminal set for that cwd, re-selecting an adjacent tab as needed.

#### Scenario: Stale terminal tab dropped on reload

- **GIVEN** persisted state has a `term:tX` tab and `tX` no longer exists after restart
- **WHEN** the pane loads
- **THEN** the `term:tX` tab SHALL be dropped and a surviving tab (if any) activated

#### Scenario: Live terminal tab restored on reload

- **GIVEN** persisted state has a `term:tY` tab and `tY` still exists
- **WHEN** the pane loads
- **THEN** the `term:tY` tab SHALL be restored and re-attach to the live session

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
