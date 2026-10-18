## MODIFIED Requirements

### Requirement: Accessible, theme-token styling
State pills SHALL convey state by text, not colour alone. Every action SHALL be
keyboard reachable with a visible focus ring. Colours SHALL come from theme
tokens; the change SHALL add no raw colour literal to client source. Text SHALL
meet WCAG 2.1 AA contrast in base dark and base light. State pills, the operate
banner and callouts, and inline action errors SHALL be rendered by the shared
status pill, notice and inline action error. An inline action error SHALL show
one sentence, with the server's error code reachable only through "Copy details".

#### Scenario: Pill readable without colour
- **WHEN** state pills are rendered in a greyscale screenshot
- **THEN** each state SHALL still be identifiable by its text label

#### Scenario: Action failure keeps the code out of the sentence
- **WHEN** a Stop request fails with code `stop_failed`
- **THEN** the error under the Stop control SHALL read as a sentence without `stop_failed`
- **AND** "Copy details" SHALL copy `stop_failed` and the server message
