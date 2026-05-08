## ADDED Requirements

### Requirement: Git branch rendered as chip in session card
In addition to the existing GroupGitInfo at the folder level, the session card SHALL render git branch information as a compact chip in its meta row. The chip SHALL include the branch name with a git icon. When gitPrNumber is set, the PR number SHALL be included in the same chip.

#### Scenario: Branch chip in card
- **WHEN** session.gitBranch is "feature/x"
- **THEN** the card SHALL render a chip with branch icon and "feature/x"

#### Scenario: Branch chip with PR
- **WHEN** session.gitBranch is "feature/x" and session.gitPrNumber is 42
- **THEN** the chip SHALL render "feature/x · #42"

#### Scenario: No git info
- **WHEN** session.gitBranch is not set
- **THEN** no git chip SHALL render in the card
