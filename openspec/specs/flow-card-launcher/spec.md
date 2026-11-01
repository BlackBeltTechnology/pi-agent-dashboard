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
