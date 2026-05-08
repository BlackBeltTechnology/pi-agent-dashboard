## ADDED Requirements

### Requirement: Attached proposal rendered as chip
The attached proposal name SHALL be rendered as a compact chip in the session card's meta row, alongside git and worktree chips.

#### Scenario: Attached proposal chip
- **WHEN** session.attachedProposal is "add-auth"
- **THEN** a chip with paperclip icon and "add-auth" SHALL render in the meta row

#### Scenario: No attached proposal
- **WHEN** session.attachedProposal is not set
- **THEN** no attached proposal chip SHALL render
