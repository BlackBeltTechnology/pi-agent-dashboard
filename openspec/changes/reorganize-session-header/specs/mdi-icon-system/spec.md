## MODIFIED Requirements

### Requirement: Labeled action buttons use icon + text pattern
Action buttons with visible text labels SHALL display an MDI icon inline before the text. The icon SHALL use `size={0.4}` with `className="inline mr-0.5"` for compact buttons, or `size={0.5}` with `className="mr-1"` for dialog-sized buttons.

#### Scenario: Session resume button has icon and text
- **WHEN** a session card renders a Resume button
- **THEN** it SHALL display `<Icon path={mdiPlayCircleOutline} size={0.4} />` followed by text "Resume"

#### Scenario: Session fork button has icon and text
- **WHEN** a session card renders a Fork button
- **THEN** it SHALL display `<Icon path={mdiSourceFork} size={0.4} />` followed by text "Fork"

#### Scenario: Run flow button has icon and text
- **WHEN** SessionHeader or SessionFlowActions renders a Run Flow button
- **THEN** it SHALL display `<Icon path={mdiPlay} size={0.4} />` followed by text "Flow" or "Run Flow..."

#### Scenario: Changed files button has icon and text
- **WHEN** SessionHeader renders the Changed Files button
- **THEN** it SHALL display the `mdiFileCompare` icon followed by the text "Changed Files" and its counts
- **AND** when the header container is narrower than 760 px the text MAY hide, in which case "Changed Files" SHALL remain the button's accessible name and tooltip

#### Scenario: Attach button has icon and text
- **WHEN** the composer session actions render the unattached "Attach change..." chip (`composer-attach-chip`)
- **THEN** it SHALL display a `mdiPaperclip` icon followed by the text "Attach change..."
- **AND** the session header SHALL NOT render an Attach button
