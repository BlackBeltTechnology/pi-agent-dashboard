## ADDED Requirements

### Requirement: No README button in folder header
The folder group header SHALL NOT render a README button. The `onViewReadme` and `readmeDirs` props SHALL be removed from the session list.

#### Scenario: README button not rendered
- **WHEN** a folder group has a README.md file
- **THEN** no README icon button SHALL appear in the group header

#### Scenario: readmeDirs prop removed
- **WHEN** SessionList is instantiated
- **THEN** `onViewReadme` and `readmeDirs` props SHALL NOT be accepted
