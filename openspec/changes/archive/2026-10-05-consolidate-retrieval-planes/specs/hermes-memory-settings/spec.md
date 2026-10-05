# hermes-memory-settings — delta

## ADDED Requirements

### Requirement: The memory settings surface hosts store hygiene

The memory settings surface SHALL present the store-hygiene inventory and its
reclamation actions alongside the existing configuration fields. Consistent with
the existing activation rule for this surface, the hygiene section SHALL be
offered only when the corresponding extension is installed, and SHALL report the
store as absent rather than erroring when the extension is installed but no
store has been created yet.

#### Scenario: Hygiene section appears with the extension installed
- **GIVEN** the memory extension is installed
- **WHEN** the operator opens the memory settings surface
- **THEN** the store-hygiene inventory SHALL be present

#### Scenario: Hygiene section is absent without the extension
- **GIVEN** the memory extension is not installed
- **WHEN** the operator opens the settings surface
- **THEN** the store-hygiene section SHALL NOT be offered

#### Scenario: Installed extension with no store yet
- **GIVEN** the memory extension is installed
- **AND** no store directory exists on disk
- **WHEN** the operator opens the hygiene section
- **THEN** it SHALL report the store as absent
- **AND** SHALL NOT report an error
- **AND** SHALL offer no reclamation action
