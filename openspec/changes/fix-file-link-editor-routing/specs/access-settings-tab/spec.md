## MODIFIED Requirements

### Requirement: Every listed grant is revocable

Each listed entry SHALL offer a revoke action that removes the grant from its own store, with one explicit carve-out: project trust, when the underlying pi contract cannot express deletion (see the project-trust requirement below), SHALL be listed read-only and marked as managed by pi. A path grant with `mode: "write"` SHALL be listed with a visible write mode and revoked on its own, leaving any read grant for the same subject.

Two stores have no revoke capability today — the worktree-init hook trust store and the KB source trust store expose only trust-check and record operations — so each SHALL gain a revoke operation. Project trust is the one exception, governed by its own requirement below. Revocation SHALL clear both the persisted entry and any in-memory session-scoped trust for that subject, so a revoked grant does not survive in memory for the life of the process.

#### Scenario: Revoking a path anchor

- **WHEN** a path-anchor grant is revoked from the Access page
- **THEN** the entry SHALL be removed from `access-grants.json`
- **AND** it SHALL disappear from the list

#### Scenario: Revoking a trusted network

- **WHEN** a trusted-network entry is revoked
- **THEN** it SHALL be removed via the existing config write path

#### Scenario: Revoking a store that had no revoke path

- **GIVEN** a worktree-init hook trust entry and a KB source trust entry
- **WHEN** either is revoked from the Access page
- **THEN** it SHALL be removed from its store
- **AND** any in-memory session-scoped trust for that subject SHALL also be cleared

#### Scenario: Revocation is reflected without restart

- **WHEN** any grant is revoked
- **THEN** the corresponding gate SHALL enforce the revocation on the next request without a server restart

#### Scenario: A write grant is shown and revoked on its own

- **GIVEN** a write grant and a read grant for the same directory
- **WHEN** the Access page lists them and the write row is revoked
- **THEN** the write row SHALL show a write mode, only that row SHALL disappear and the read row SHALL remain
