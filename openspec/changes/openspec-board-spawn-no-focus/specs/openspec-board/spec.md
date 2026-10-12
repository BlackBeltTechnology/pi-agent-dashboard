## ADDED Requirements

### Requirement: Board spawns do not take focus
Every session spawn initiated from the OpenSpec board — the card `+ Session` action, the card `New worktree` action (through the worktree spawn dialog), and the New-proposal dialog's create-and-spawn with or without the worktree option — SHALL be dispatched with the "no focus" intent defined by `spawn-correlation`. The app SHALL keep the user on the board when the spawned session registers; the spawn placeholder SHALL still clear and the new session SHALL appear on its proposal card's session list. Spawns initiated from any other surface (folder view, sidebar, fork, resume) SHALL keep their existing auto-focus behavior, including when the board happens to be open.

#### Scenario: Card + Session stays on the board
- **WHEN** the user clicks `+ Session` on a proposal card on `/folder/<cwd>/openspec`
- **AND** the spawned session registers
- **THEN** the route SHALL remain `/folder/<cwd>/openspec`
- **AND** the new session SHALL be listed on that proposal card

#### Scenario: Card New worktree stays on the board
- **WHEN** the user clicks `New worktree` on a proposal card and confirms the worktree spawn dialog
- **AND** the worktree session registers
- **THEN** the route SHALL remain `/folder/<cwd>/openspec`
- **AND** the spawn placeholder for the parent folder SHALL be cleared

#### Scenario: New-proposal create-and-spawn stays on the board
- **WHEN** the user submits the New-proposal dialog (with or without the worktree option)
- **AND** the spawned session registers
- **THEN** the route SHALL remain `/folder/<cwd>/openspec`

#### Scenario: Non-board spawn while board is open still focuses
- **WHEN** the board is open and a spawn is initiated from a non-board surface (e.g. the sidebar `+`)
- **AND** that session registers
- **THEN** the app SHALL navigate to the new session as before
