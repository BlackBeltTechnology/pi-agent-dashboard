# add-to-workspace-affordance Specification

## Purpose

Define the visual affordance on a top-level folder card that opens the add-to-workspace menu — its labelling, styling, target size, and visibility gating — so the gesture for organizing folders into workspaces is legible and discoverable.
## Requirements
### Requirement: Labelled add-to-workspace button

The add-to-workspace gesture SHALL be surfaced as a labelled item inside the folder actions
menu, grouped under a workspace heading, rather than as a standalone pill in the folder
header cluster. The item SHALL render an `mdiViewGridPlus` icon followed by the visible text
label "Add to workspace…".

The `mdiViewGridPlus` glyph SHALL be reserved for the add-to-workspace meaning and SHALL NOT
be reused for any other action on the directory card.

The gesture SHALL NOT be surfaced on session cards. A session's directory membership is a
property of its directory, and duplicating the control per session renders N identical
controls with one effect.

#### Scenario: Add-to-workspace renders as a grouped menu item

- **WHEN** the folder actions menu opens for a top-level folder
- **THEN** a workspace group SHALL contain an item displaying the `mdiViewGridPlus` icon and the label "Add to workspace…"
- **AND** no add-to-workspace pill SHALL render in the folder header cluster

#### Scenario: Session cards carry no add-to-workspace control

- **WHEN** a session card renders inside a folder
- **THEN** it SHALL NOT render an add-to-workspace control

#### Scenario: The workspace glyph is not reused

- **WHEN** the directory card renders any other action, including project setup
- **THEN** that action SHALL NOT use the `mdiViewGridPlus` glyph

### Requirement: Preserved behavior and gating

Relocating the affordance SHALL NOT change its behavior. Activating the item SHALL open the
existing `AddToWorkspaceMenu`, SHALL stop click propagation so it does not trigger folder
navigation, and SHALL be present only when at least one workspace exists or a workspace can
be created. When the gating fails, the item SHALL be absent from the menu rather than
rendered disabled.

The `add-to-workspace-btn-<cwd>` test id SHALL be retained on the item so existing
automation keeps a stable handle, with the menu-open step becoming a prerequisite.

#### Scenario: Click opens the add-to-workspace menu

- **WHEN** a user activates the add-to-workspace item in a folder's actions menu
- **THEN** the `AddToWorkspaceMenu` for that folder SHALL open
- **AND** the folder-home navigation SHALL NOT be triggered by the click

#### Scenario: Visibility gating unchanged

- **WHEN** no workspaces exist and no create-workspace handler is available
- **THEN** the add-to-workspace item SHALL NOT be present in the folder actions menu
- **WHEN** at least one workspace exists or a create-workspace handler is available
- **THEN** the add-to-workspace item SHALL be present in the folder actions menu

#### Scenario: Test id preserved

- **WHEN** the folder actions menu is open for a folder at path `<cwd>`
- **THEN** the add-to-workspace item SHALL expose the test id `add-to-workspace-btn-<cwd>`

