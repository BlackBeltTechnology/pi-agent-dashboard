## ADDED Requirements

### Requirement: Dialog honors an explicit initial-focus target

When a dialog descendant is marked `data-autofocus` and is focusable, the focus trap SHALL move initial focus to the first such descendant instead of the first focusable descendant. Dialogs with no marked descendant SHALL behave as before.

#### Scenario: Marked control receives initial focus
- **GIVEN** a dialog whose Cancel button carries `data-autofocus` and whose first focusable element is the built-in ✕
- **WHEN** the dialog opens
- **THEN** focus SHALL be on the Cancel button

#### Scenario: Unmarked dialogs unchanged
- **GIVEN** a dialog with no `data-autofocus` descendant
- **WHEN** the dialog opens
- **THEN** focus SHALL move to the first focusable descendant as before
