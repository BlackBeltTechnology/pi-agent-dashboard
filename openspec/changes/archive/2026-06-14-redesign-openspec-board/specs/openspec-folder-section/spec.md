## MODIFIED Requirements

### Requirement: Collapsible change list in folder section
The folder OpenSpec section SHALL render as a single-line entry that navigates to the full-page OpenSpec board instead of expanding inline. The entry SHALL show the OpenSpec label, the change count, and a Refresh control, and SHALL act as a button that opens the board route `/folder/:encodedCwd/openspec`. The inline collapsible change tree, group pills, and in-section search SHALL be removed (their functionality moves to the board).

#### Scenario: Single-line navigation entry
- **WHEN** the folder OpenSpec section is rendered for a cwd with N changes
- **THEN** it SHALL show `OpenSpec (N) →` with a Refresh control and SHALL NOT render an inline change tree

#### Scenario: Click opens the board
- **WHEN** the user clicks the folder OpenSpec entry
- **THEN** the app SHALL navigate to `/folder/<encodedCwd>/openspec`

#### Scenario: No inline expansion
- **WHEN** the user interacts with the folder OpenSpec entry
- **THEN** there SHALL be no inline expand/collapse of a change list in the folder card
