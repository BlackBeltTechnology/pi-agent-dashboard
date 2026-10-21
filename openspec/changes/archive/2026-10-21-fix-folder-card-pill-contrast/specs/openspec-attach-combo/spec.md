## MODIFIED Requirements

### Requirement: PDST rendered as single button navigating to proposal
The chat-view session header (desktop and mobile) SHALL render the attached change's artifact letters as a single combined button (`ArtifactLettersButton`). Each letter keeps its status color: done → `--accent-green-text`, ready → `--accent-yellow-text`, any other status → `--text-secondary`. Clicking the button navigates to the proposal artifact. The session card SHALL NOT render this button; there the lifecycle bar carries per-artifact state and navigation.

#### Scenario: Single PDST button in attached session
- **WHEN** session `"s1"` has `attachedProposal = "add-auth"` with artifacts `[proposal: done, design: ready, specs: blocked, tasks: blocked]`
- **THEN** the chat-view session header SHALL show a single clickable button containing `P D S T` painted `--accent-green-text`, `--accent-yellow-text`, `--text-secondary`, `--text-secondary` respectively
- **AND** the session card SHALL NOT show that button

#### Scenario: Clicking PDST button opens proposal
- **WHEN** the user clicks the PDST button for change `"add-auth"`
- **THEN** `onReadArtifact("add-auth", "proposal")` SHALL be called
