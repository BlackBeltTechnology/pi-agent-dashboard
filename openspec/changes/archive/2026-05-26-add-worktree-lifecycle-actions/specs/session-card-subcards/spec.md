## ADDED Requirements

### Requirement: cwd-gone pill on session card
The WORKSPACE subcard SHALL render a small red `cwd gone` pill (analogous to the existing `worktree` pill) when `session.cwdMissing === true`. The pill SHALL carry tooltip text "session's directory no longer exists".

#### Scenario: Pill renders for cwd-missing session
- **WHEN** the card renders a session with `cwdMissing: true`
- **THEN** the WORKSPACE subcard SHALL contain `[data-testid="cwd-gone-pill"]`

#### Scenario: Pill absent for healthy session
- **WHEN** `cwdMissing` is `undefined` or `false`
- **THEN** the pill SHALL NOT render

### Requirement: Resume button disabled when cwd missing
The session card SHALL disable its resume button and show tooltip "session's directory no longer exists" when `session.cwdMissing === true`.

#### Scenario: Resume disabled
- **WHEN** the user hovers the resume button on a cwd-missing session
- **THEN** the button SHALL be disabled
- **AND** the tooltip SHALL read "session's directory no longer exists"
