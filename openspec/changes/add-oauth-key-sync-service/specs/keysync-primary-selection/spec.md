## ADDED Requirements

### Requirement: Each member has one primary per provider
The service SHALL record, per member and per provider, at most one primary account drawn from that member's selection pool.

#### Scenario: Setting a primary clears the previous one
- **WHEN** a member marks an account primary for a provider where another account was already primary
- **THEN** exactly one account remains primary for that member and provider

#### Scenario: Primary must be an account the member owns
- **WHEN** a member attempts to mark an account they do not own as primary
- **THEN** the request is rejected, whether or not that account is shared with them

#### Scenario: A shared account may be rotated to but not pinned
- **WHEN** a member's pool contains a teammate's shared account
- **THEN** selection may rotate onto it after the member's own accounts are exhausted, but it cannot be set as their primary

#### Scenario: Rotation off confines traffic to owned accounts
- **WHEN** rotation is disabled and a member issues a request
- **THEN** the account selected is one the member owns, so disabling rotation provably ends all cross-account traffic

### Requirement: A healthy primary is preferred
Selection SHALL choose the member's primary account whenever that account is in state `ok`.

#### Scenario: Primary healthy
- **WHEN** a request arrives and the member's primary account is `ok`
- **THEN** the primary account is selected

#### Scenario: Return to primary after recovery
- **WHEN** a member's primary account leaves `cooling` and returns to `ok`
- **THEN** subsequent requests select the primary again without member action

### Requirement: Losing an account clears its primary status
When an account becomes unavailable to a member, any primary designation that member held on it SHALL be cleared.

#### Scenario: Primary account is unshared by its owner
- **WHEN** the owner unshares an account another member had marked primary
- **THEN** that member's primary designation is cleared and selection falls back to the remaining pool
