# Spec Delta

## MODIFIED Requirements

### Requirement: Pane SHALL expose a new-terminal affordance

The editor pane SHALL provide a control to create a new terminal at the pane's cwd and open it as an active tab: the **Terminal** item of the pane bar's New tab menu (see `editor-pane-chrome`). Activating that item SHALL call the terminal-create flow and add the resulting `term:<id>` tab.

#### Scenario: Create a terminal from the pane

- **WHEN** the user chooses Terminal from the New tab menu in a pane rooted at `/home/u/proj`
- **THEN** a terminal SHALL be created with cwd `/home/u/proj`
- **AND** its `term:<id>` tab SHALL open active in the pane
