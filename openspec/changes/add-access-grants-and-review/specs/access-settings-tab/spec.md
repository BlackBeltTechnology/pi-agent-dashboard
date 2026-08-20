## ADDED Requirements

### Requirement: Unified Access settings surface

The dashboard SHALL provide a `Settings → Access` page listing every access grant across all eight stores: path-anchor grants, `config.trustedNetworks`, `auth.bypassHosts`, CORS origins, pinned directories, KB source trust, worktree-init hook trust, and project trust. Each entry SHALL show its subject and the store it belongs to.

`auth.bypassHosts` SHALL be listed as its own store rather than folded into trusted networks, because it is a separate persisted field that the network guard merges with `trustedNetworks` at runtime, and it is the canonical UI write path for host trust.

#### Scenario: Grants from every store are listed

- **WHEN** the Access page is opened
- **THEN** it SHALL show entries drawn from each of the grant stores that holds at least one entry

#### Scenario: Empty state

- **WHEN** no store holds any grant
- **THEN** the page SHALL render an empty state rather than an error

#### Scenario: bypassHosts entries are distinguishable from trustedNetworks

- **GIVEN** a host is present in `auth.bypassHosts` and a CIDR is present in `config.trustedNetworks`
- **WHEN** the Access page lists them
- **THEN** each SHALL be labelled with the store it came from, so revoking targets the correct field

### Requirement: Stores are read in place, not migrated

The Access page SHALL read each grant store at its existing location and SHALL NOT consolidate, rewrite, or relocate any existing store. In particular pi's own project-trust store SHALL be read through pi's API and never rewritten by the dashboard except through that API.

#### Scenario: Opening the page does not rewrite stores

- **WHEN** the Access page loads
- **THEN** no grant store file SHALL be modified

#### Scenario: Existing store formats are unchanged

- **WHEN** this capability ships
- **THEN** `worktree-init-trust.json`, `kb-source-trust.json`, `config.trustedNetworks`, `cors.allowedOrigins`, pinned directories, and the pi project-trust store SHALL retain their current formats

### Requirement: Every listed grant is revocable

Each listed entry SHALL offer a revoke action that removes the grant from its own store.

Two stores have no revoke capability today — the worktree-init hook trust store and the KB source trust store expose only trust-check and record operations — so each SHALL gain a revoke operation. Revocation SHALL clear both the persisted entry and any in-memory session-scoped trust for that subject, so a revoked grant does not survive in memory for the life of the process.

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

### Requirement: KB source trust entries are displayable

The KB source trust store records only a hash of each trusted source specification, so an entry's subject cannot be recovered from the store as it exists. The store SHALL record the source subject alongside the hash so entries are displayable. This SHALL be an additive field: an entry written before this change and carrying no subject SHALL render as its opaque hash rather than causing an error, and no rewrite of existing entries SHALL be performed.

#### Scenario: New entries display their subject

- **WHEN** a KB source is trusted after this change
- **THEN** its Access-page entry SHALL display the source reference

#### Scenario: Pre-existing entries degrade gracefully

- **GIVEN** a trust entry written before this change, carrying only a hash
- **WHEN** the Access page lists it
- **THEN** it SHALL render as an opaque hash with a revoke action, and SHALL NOT error
