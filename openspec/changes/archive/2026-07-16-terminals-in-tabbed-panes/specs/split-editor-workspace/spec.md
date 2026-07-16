# split-editor-workspace

## ADDED Requirements

### Requirement: Editor pane SHALL host terminal tabs alongside file tabs

The editor pane (in both the session split and the folder-scoped pane) SHALL host terminal tabs (`term:<id>`, viewer kind `terminal`) in the same tab strip as file, diff, and live-server tabs. Terminal tabs SHALL participate in the same activation, reorder, and close behaviors as other tabs. See `terminal-viewer-tab` for terminal lifecycle.

#### Scenario: Terminal tab coexists with file tabs

- **GIVEN** an editor pane with `src/foo.ts` open
- **WHEN** a terminal tab `term:t1` is opened
- **THEN** both tabs SHALL appear in the tab strip and be independently selectable

### Requirement: Pane SHALL expose a new-terminal affordance

The editor pane SHALL provide a control to create a new terminal at the pane's cwd and open it as an active tab. Activating the control SHALL call the terminal-create flow and add the resulting `term:<id>` tab.

#### Scenario: Create a terminal from the pane

- **WHEN** the user activates the pane's new-terminal control in a pane rooted at `/home/u/proj`
- **THEN** a terminal SHALL be created with cwd `/home/u/proj`
- **AND** its `term:<id>` tab SHALL open active in the pane
