## MODIFIED Requirements

### Requirement: Compact-empty affordance

In accordion mode, a folder rendering `compact empty` SHALL show its session count in the condensed header as a subdued `N` (accessible name `N sessions`), where N counts the folder's sessions after the hidden-session and search filters, and SHALL render no separate row below the header. Activating the header SHALL focus the folder without changing its collapsed or pinned-open state. When N is zero the count SHALL NOT render.

#### Scenario: Count shown
- **GIVEN** unfocused `/foo` with 18 visible sessions, none needing attention
- **THEN** its header SHALL show `18` with accessible name `18 sessions`
- **AND** no `N sessions — click to view` row SHALL render

#### Scenario: Activating focuses
- **WHEN** the user activates the header of `/foo`, even while a session in another folder is selected
- **THEN** `/foo` SHALL become the focused folder
- **AND** its collapsed and pinned-open state SHALL be unchanged

#### Scenario: Empty folder
- **GIVEN** unfocused `/foo` with zero visible sessions
- **THEN** only its condensed header SHALL render, with no count
