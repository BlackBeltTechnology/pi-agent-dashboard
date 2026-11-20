## MODIFIED Requirements

### Requirement: Compact-empty affordance

In accordion mode, a folder rendering `compact empty` SHALL show its session count in the condensed header as a subdued `N`, and SHALL render no separate row below the header. N counts the folder's sessions after the hidden-session and search filters. The count SHALL be a `<button>` rendered as a sibling of the header name link (not inside its accessible name), with accessible name `N sessions`, painted `--text-secondary` or stronger (never `--text-muted`), and its click SHALL stop propagation so it does NOT navigate to the folder home. Activating the count SHALL focus the folder without changing its collapsed or pinned-open state. When N is zero the count SHALL NOT render. Clicking the rest of the header keeps its existing behaviour (focus the folder and open the folder home).

#### Scenario: Count shown
- **GIVEN** unfocused `/foo` with 18 visible sessions, none needing attention
- **THEN** its header SHALL show `18` with accessible name `18 sessions`
- **AND** no `N sessions — click to view` row SHALL render

#### Scenario: Activating focuses
- **WHEN** the user activates the count button of `/foo`, even while a session in another folder is selected
- **THEN** `/foo` SHALL become the focused folder
- **AND** its collapsed and pinned-open state SHALL be unchanged
- **AND** the current route SHALL NOT change

#### Scenario: Header name link unchanged
- **WHEN** the user presses Enter on the header name link of `/foo`
- **THEN** `/foo` SHALL become the focused folder and the folder home SHALL open, with the link's accessible name unaffected by the count

#### Scenario: Empty folder
- **GIVEN** unfocused `/foo` with zero visible sessions
- **THEN** only its condensed header SHALL render, with no count
