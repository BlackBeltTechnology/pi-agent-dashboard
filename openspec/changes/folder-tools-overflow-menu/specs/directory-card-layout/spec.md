# directory-card-layout — delta

## ADDED Requirements

### Requirement: Folder creation actions remain primary
An expanded folder card SHALL keep New Session and, when eligible, New Worktree
visible as its primary creation actions. Secondary folder integrations SHALL NOT
displace those controls from the expanded folder body.

#### Scenario: Folder with worktree support
- **GIVEN** an expanded git-capable folder with worktrees enabled
- **WHEN** the folder renders
- **THEN** New Session and New Worktree SHALL be visible before any secondary
  tools trigger

### Requirement: Secondary folder integrations use an overflow menu
The dashboard SHALL expose a Folder tools overflow trigger when a folder has
one or more eligible secondary integrations. The trigger SHALL reveal the
existing plugin folder sections and eligible OpenSpec folder section without
changing their existing action semantics.

#### Scenario: Knowledge Base and OpenSpec are available
- **GIVEN** a folder with a claimed Knowledge Base slot and initialized OpenSpec
  data
- **WHEN** the operator opens Folder tools
- **THEN** the menu SHALL render the Knowledge Base section and the existing
  OpenSpec section
- **AND** their existing callbacks SHALL remain available

#### Scenario: No secondary integration is available
- **GIVEN** a folder without a claimed folder slot and without initialized or
  pending OpenSpec data
- **WHEN** the folder renders
- **THEN** it SHALL NOT render an empty Folder tools trigger

### Requirement: Folder tools trigger is accessible and non-disruptive
The Folder tools trigger SHALL be keyboard accessible, indicate its expanded
state, and SHALL NOT toggle/collapse the containing folder when operated.

#### Scenario: Opening tools preserves the folder state
- **GIVEN** an expanded folder
- **WHEN** the operator activates Folder tools
- **THEN** the tools menu SHALL open
- **AND** the folder SHALL remain expanded
