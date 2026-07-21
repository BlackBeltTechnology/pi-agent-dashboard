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

