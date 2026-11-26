## MODIFIED Requirements

### Requirement: Session slot rendered inside proposal cards
A proposal card on the board SHALL list the sessions attached to that change, each row rendering the session-card OpenSpec slot: a status-tinted indicator, the session name, age, the OpenSpec phase badge (phase + `completed/total`), and a stat line (tokens up/down, context usage, cost). Clicking a session row SHALL navigate to that session's chat view.

#### Scenario: Session row content
- **WHEN** a change has an attached session that is implementing with `48k↓ 12k↑`, `$0.41`, and phase tasks `9/14`
- **THEN** the row SHALL show the status indicator, name, age, an `IMPLEMENTING 9/14` phase badge, and `48k↓ 12k↑ … $0.41`

#### Scenario: Click navigates to session
- **WHEN** the user clicks a session row
- **THEN** the app SHALL navigate to that session's chat view
