## ADDED Requirements

### Requirement: Atomic reset-to-npm composite operation
Package management SHALL provide an atomic composite operation that resets a source-override package to its canonical published npm version by installing the `npm:<name>` spec FIRST and, only on a successful install, removing the local/git `settings.json#packages[]` entry — both in the row's own scope. This mirrors the existing scope-to-scope move (install-new + remove-old) but swaps the source kind (local/git → npm) rather than the scope.

The operation SHALL surface a package action value `reset` and SHALL emit a `package_operation_complete` WebSocket event through the same composite-operation protocol as `move`. If the install step fails, the local/git entry SHALL remain untouched and the operation SHALL report failure. If the install succeeds but the remove step fails, the operation SHALL report partial success (npm installed, local/git entry still present) so the client can surface a cleanup affordance.

#### Scenario: Successful reset installs npm then drops local entry
- **WHEN** a reset is requested for an override row whose canonical spec is `npm:<name>` in scope S
- **THEN** `npm:<name>` SHALL be installed in scope S first
- **AND** on install success the original local/git `packages[]` entry SHALL be removed from scope S
- **AND** a `package_operation_complete` event with action `reset` SHALL be emitted

#### Scenario: Install failure leaves override intact
- **WHEN** the `npm:<name>` install step fails during a reset
- **THEN** the original local/git entry SHALL remain registered
- **AND** the operation SHALL report failure without removing anything

#### Scenario: Partial success when remove fails after install
- **WHEN** the npm install succeeds but removing the local/git entry fails
- **THEN** the operation SHALL report partial success naming both the installed npm spec and the still-present local/git entry
