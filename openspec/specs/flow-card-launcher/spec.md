# flow-card-launcher Specification

## Purpose

Lets the user start a pi-flow directly from a session card. Defines the launcher section on the card, how flow commands are distinguished from ordinary commands, a searchable selection dialog built on a shared component, and the task-input step that follows selection.

## Requirements

### Requirement: Shared SearchableSelectDialog component
A reusable `SearchableSelectDialog` component SHALL be provided for use by both the flow launcher and OpenSpec attach picker. The dialog SHALL render as a centered overlay (via `DialogPortal`) with a backdrop, a title, a search input field, and a scrollable list of options. Each option SHALL display a label, optional description text, and optional badge.

#### Scenario: Keyboard navigation
- **WHEN** the dialog is open
- **THEN** ↑↓ SHALL navigate options, Enter SHALL select the highlighted option, Esc SHALL cancel

#### Scenario: Real-time filtering
- **WHEN** the user types in the search field
- **THEN** the list SHALL filter to options whose label or description contains the query (case-insensitive)

#### Scenario: Empty state
- **WHEN** no options match the filter
- **THEN** the dialog SHALL display a configurable empty message

#### Scenario: Mouse interaction
- **WHEN** the user hovers over an option
- **THEN** that option SHALL be highlighted, and clicking SHALL select it

### Requirement: Session card flow launcher section
When a session has available flow commands, the session card SHALL display a flow launcher action section below the OpenSpec actions section.

#### Scenario: Flow launcher visible
- **WHEN** the session's commands list contains flow commands
- **THEN** the session card SHALL show a flow launcher with a combo box or button listing available flows

#### Scenario: Flow launcher hidden
- **WHEN** the session has no flow commands
- **THEN** no flow launcher section SHALL be displayed

### Requirement: Flow command detection via exclusion heuristic
Flow commands SHALL be detected from the session's `commands` list by filtering commands where `source` is `"extension"` and the name is NOT in the excluded set: `flows`, `flows:new`, `flows:edit`, `flows:delete`, `provider`, `roles`, `catalog`. This captures auto-registered flow slash commands while excluding pi-flows management commands.

#### Scenario: Flow commands filtered correctly
- **WHEN** the commands list contains `[{name: "research", source: "extension"}, {name: "flows:new", source: "extension"}, {name: "provider", source: "extension"}, {name: "model", source: "builtin"}]`
- **THEN** only `"research"` SHALL be identified as a launchable flow command

### Requirement: Flow launcher section labeled
The flow launcher section on the session card SHALL display a "Flows:" label before the action button to distinguish it from other card sections.

#### Scenario: Flows label visible
- **WHEN** flow commands are available
- **THEN** the session card SHALL show "Flows:" followed by a "▶ Run Flow..." button

### Requirement: Flow selection uses searchable dialog
Clicking the "▶ Run Flow..." button SHALL open a `SearchableSelectDialog` listing available flows with name and description. The dialog SHALL support keyboard navigation (↑↓ Enter Esc) and real-time text filtering.

#### Scenario: Open flow picker
- **WHEN** the user clicks "▶ Run Flow..."
- **THEN** a searchable dialog SHALL appear with all available flows, each showing name and description

#### Scenario: Filter flows by typing
- **WHEN** the user types in the search field
- **THEN** the list SHALL filter to flows whose name or description contains the query

### Requirement: Task input dialog after flow selection
Selecting a flow from the searchable dialog SHALL open a `FlowLaunchDialog` with the flow name, description, and a text input for the task/context.

#### Scenario: Submit launches flow
- **WHEN** the user enters a task and submits the dialog
- **THEN** a `send_prompt` message SHALL be sent with `/<flowName> <task>`
