## ADDED Requirements

### Requirement: Confirm can default focus to Cancel

`Confirm` SHALL accept `defaultFocus="cancel"`; when set, its Cancel button SHALL receive initial focus on open (via the dialog's initial-focus target). Without it, focus behavior SHALL be unchanged. Destructive confirmations SHOULD set it.

#### Scenario: Cancel focused for a destructive confirm
- **GIVEN** a `Confirm` with `intent="danger"` and `defaultFocus="cancel"`
- **WHEN** it opens
- **THEN** focus SHALL be on the Cancel button, and pressing Enter SHALL cancel

#### Scenario: Default unchanged
- **GIVEN** a `Confirm` without `defaultFocus`
- **WHEN** it opens
- **THEN** focus SHALL land where it did before this change
