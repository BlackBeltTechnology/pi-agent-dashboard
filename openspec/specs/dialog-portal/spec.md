# dialog-portal Specification

## Purpose

Renders dialogs at `document.body` through a portal so they escape ancestor stacking and overflow contexts, and locks background scroll while a dialog is open.

## Requirements

### Requirement: DialogPortal renders children at document.body
The DialogPortal component SHALL render its children via `ReactDOM.createPortal` to `document.body`, escaping all ancestor stacking contexts.

#### Scenario: Dialog escapes overflow-hidden ancestor
- **WHEN** a dialog is wrapped in `<DialogPortal>` inside a container with `overflow-hidden`
- **THEN** the dialog SHALL render at `document.body` and be fully visible

#### Scenario: Dialog layers above MobileOverlay
- **WHEN** a dialog is opened from within the mobile sidebar overlay
- **THEN** the dialog SHALL render above the MobileOverlay (z-[60] > z-50)

### Requirement: Scroll lock when dialog is open
The DialogPortal SHALL prevent background scrolling while mounted.

#### Scenario: Background scroll locked
- **WHEN** a DialogPortal is mounted
- **THEN** `document.body.style.overflow` SHALL be set to `'hidden'`

#### Scenario: Scroll restored on close
- **WHEN** a DialogPortal is unmounted
- **THEN** `document.body.style.overflow` SHALL be restored to its previous value
