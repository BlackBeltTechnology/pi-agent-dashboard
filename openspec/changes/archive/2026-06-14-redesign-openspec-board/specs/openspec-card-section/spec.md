## ADDED Requirements

### Requirement: Session slot rendered inside proposal cards
A proposal card on the board SHALL list the sessions attached to that change, each row rendering the session-card OpenSpec slot: a status-tinted indicator, the session name, age, the OpenSpec phase badge (phase + `completed/total`), and a stat line (tokens up/down, context usage, cost). Clicking a session row SHALL navigate to that session's chat view.

#### Scenario: Session row content
- **WHEN** a change has an attached session that is implementing with `48k↑ 12k↓`, `$0.41`, and phase tasks `9/14`
- **THEN** the row SHALL show the status indicator, name, age, an `IMPLEMENTING 9/14` phase badge, and `48k↑ 12k↓ … $0.41`

#### Scenario: Click navigates to session
- **WHEN** the user clicks a session row
- **THEN** the app SHALL navigate to that session's chat view

### Requirement: Per-session actions on proposal cards
Each session row SHALL expose lifecycle actions — resume/continue, fork, and hide/unhide — and an OpenSpec command menu exposing the session OpenSpec actions (Explore, Advance phase, Fast-forward, Apply, Verify, Archive, Detach). Action clicks SHALL NOT trigger row navigation.

#### Scenario: Resume and fork available
- **WHEN** a session row has a session file
- **THEN** the row SHALL offer a fork action, and a resume action when the session is ended or hidden

#### Scenario: Hide toggles
- **WHEN** the user activates hide on a visible session row
- **THEN** the session SHALL be hidden and the row SHALL offer an unhide action

#### Scenario: OpenSpec command menu
- **WHEN** the user opens a session row's OpenSpec command menu
- **THEN** it SHALL list Explore, Advance phase, Fast-forward, Apply, Verify, Archive, and Detach

#### Scenario: Action click does not navigate
- **WHEN** the user clicks any session-row action
- **THEN** the app SHALL NOT navigate to the session chat view

### Requirement: Worktree state visualization on session rows
A session whose cwd is a git worktree SHALL show a worktree marker on its row displaying the worktree name and that worktree's own task progress (`completed/total`) with a delta relative to the proposal's main-checkout progress. The proposal card's progress bar SHALL continue to reflect the main checkout, not the worktree.

#### Scenario: Worktree marker with delta ahead
- **WHEN** the proposal (main) is `6/14` and a worktree session's own `tasks.md` is `9/14`
- **THEN** the row SHALL show `⎇ <worktree-name>` with `9/14` and a `+3` ahead delta
- **AND** the card progress bar SHALL still show `6/14`

#### Scenario: Worktree marker with delta behind
- **WHEN** the proposal (main) is `8/14` and a worktree session's own `tasks.md` is `5/14`
- **THEN** the row SHALL show the worktree marker with `5/14` and a `-3` behind delta

#### Scenario: Non-worktree session shows no marker
- **WHEN** a session's cwd is the main checkout (not a worktree)
- **THEN** the row SHALL NOT render a worktree marker
