## ADDED Requirements

### Requirement: Unrelated session activity does not disturb the foreground transcript

Activity in a session the user is NOT viewing — streaming assistant output,
thinking updates, tool progress, or any other per-session state change — SHALL
NOT cause the selected session's rendered transcript to be replaced in the DOM.

Specifically, rendered markdown content in the foreground transcript SHALL retain
its DOM node identity across a background session's state updates: paragraphs,
inline code, links and tables that are unchanged SHALL be reconciled in place
rather than unmounted and recreated. A browser selection anchored in that content
SHALL therefore survive background activity intact and copyable.

This SHALL hold under sustained background streaming, not merely for isolated
updates.

#### Scenario: Background stream does not collapse a foreground selection
- **GIVEN** the user holds a text selection in the transcript of the selected session
- **WHEN** a different, unselected session streams assistant output or emits thinking updates
- **THEN** the selection SHALL remain intact and copyable

#### Scenario: Foreground markdown nodes keep their identity
- **GIVEN** the selected session's transcript contains rendered paragraphs, inline code, links and a table
- **WHEN** an unselected session's state updates and no content of the selected session changed
- **THEN** those rendered markdown DOM nodes SHALL NOT be replaced

#### Scenario: Sustained background activity produces no foreground churn
- **GIVEN** the selected session's transcript is idle and rendered
- **WHEN** an unselected session emits a continuous high-rate stream of state updates
- **THEN** the selected transcript's markdown subtree SHALL undergo no node replacement
- **AND** a selection held throughout SHALL remain intact

#### Scenario: Foreground content changes still render
- **WHEN** the selected session itself receives new or updated content
- **THEN** that content SHALL render as normal
