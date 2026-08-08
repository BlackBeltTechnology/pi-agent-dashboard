# add-to-workspace-affordance Specification

## Purpose

Define the visual affordance on a top-level folder card that opens the add-to-workspace menu — its labelling, styling, target size, and visibility gating — so the gesture for organizing folders into workspaces is legible and discoverable.

## ADDED Requirements

### Requirement: Labelled add-to-workspace button

A top-level folder card SHALL surface the add-to-workspace gesture as a labelled pill button, not a bare abbreviation. The button SHALL render an `mdiViewGridPlus` icon followed by the visible text label "Workspace", and SHALL carry the soft-blue affordance treatment shared with the sidebar "New Workspace" button (blue foreground, blue border at reduced opacity, faint blue fill), so it reads as an interactive, well-defined control across all themes.

#### Scenario: Button renders as an icon-plus-text pill

- **WHEN** a top-level folder card renders its add-to-workspace affordance
- **THEN** the control SHALL display an `mdiViewGridPlus` icon and the text label "Workspace"
- **AND** the control SHALL have a visible border and background fill (not a borderless bare label)

#### Scenario: Comfortable target and legibility

- **WHEN** the add-to-workspace button renders
- **THEN** its text SHALL be at least the card's small-text size (not the former 10px micro-label)
- **AND** it SHALL use the shared blue affordance tokens so it is distinguishable from surrounding text at rest and on hover

### Requirement: Preserved behavior and gating

Restyling the affordance SHALL NOT change its behavior. The button SHALL open the existing `AddToWorkspaceMenu` on click, SHALL stop click propagation so it does not trigger folder navigation, SHALL retain the `add-to-workspace-btn-<cwd>` test id, and SHALL render only when at least one workspace exists or a workspace can be created.

#### Scenario: Click opens the add-to-workspace menu

- **WHEN** a user clicks the add-to-workspace button on a folder card
- **THEN** the `AddToWorkspaceMenu` for that folder SHALL open
- **AND** the folder-home navigation SHALL NOT be triggered by the click

#### Scenario: Visibility gating unchanged

- **WHEN** no workspaces exist and no create-workspace handler is available
- **THEN** the add-to-workspace button SHALL NOT render
- **WHEN** at least one workspace exists or a create-workspace handler is available
- **THEN** the add-to-workspace button SHALL render on the top-level folder card

#### Scenario: Test id preserved

- **WHEN** the add-to-workspace button renders for a folder at path `<cwd>`
- **THEN** it SHALL expose the test id `add-to-workspace-btn-<cwd>`
