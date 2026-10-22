# Spec Delta

## MODIFIED Requirements

### Requirement: Terminal tab lifecycle — create, activate, rename, close

The pane SHALL expose a new-terminal affordance (the Terminal item of the New tab menu) that creates a terminal at the pane cwd and opens its tab active. Renaming a terminal tab SHALL call the existing rename handler; closing a terminal tab (`×`, middle-click, Cmd/Ctrl-W or the tab context menu's Close) SHALL kill the terminal and activate an adjacent tab without a confirmation; a bulk close that includes terminal tabs SHALL follow the bulk-close confirmation of `editor-pane-chrome`. Switching away from a terminal tab SHALL keep the terminal alive (keep-alive), and there SHALL be at most one mounted `TerminalView` per terminal id within a pane.

#### Scenario: Create from the pane

- **WHEN** the user chooses Terminal from the New tab menu
- **THEN** a terminal SHALL be created at the pane cwd and its `term:<id>` tab SHALL open active

#### Scenario: Close kills the terminal

- **WHEN** the user closes a `term:<id>` tab
- **THEN** the terminal `<id>` SHALL be killed
- **AND** an adjacent tab SHALL become active

#### Scenario: Switching tabs keeps the terminal alive

- **GIVEN** a `term:t1` tab and a file tab
- **WHEN** the user switches to the file tab and back
- **THEN** the `t1` session SHALL remain attached (not re-spawned)
