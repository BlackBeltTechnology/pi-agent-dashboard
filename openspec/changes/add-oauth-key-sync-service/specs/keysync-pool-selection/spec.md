## ADDED Requirements

### Requirement: A member's pool spans their own and shared accounts
Selection SHALL consider a member's own accounts, regardless of visibility, together with every account shared by other members.

#### Scenario: Private and shared are both eligible
- **WHEN** a member holds one private account and one shared account is available from a teammate
- **THEN** both are eligible for selection for that member

#### Scenario: Another member's private account is never eligible
- **WHEN** a member's request is selected for
- **THEN** no account that is `private` and owned by a different member is considered

### Requirement: Selection is provenance-blind
Ordering SHALL NOT distinguish a member's own accounts from accounts shared by others, except through the member's explicit primary designation.

#### Scenario: Failover crosses ownership without preference
- **WHEN** a member's primary account is unavailable and both an own account and a shared account are healthy
- **THEN** selection applies the same ordering rule to both, with no implicit preference for ownership

### Requirement: Account health states govern eligibility
Each account SHALL hold state `ok`, `cooling`, or `dead`, and selection SHALL consider only accounts in `ok`.

#### Scenario: Cooling account is skipped
- **WHEN** an account is `cooling` and its cooldown has not elapsed
- **THEN** selection skips it

#### Scenario: Cooldown elapses
- **WHEN** a `cooling` account's cooldown elapses
- **THEN** the account returns to `ok` and becomes eligible again

#### Scenario: Dead account is never selected
- **WHEN** an account is `dead`
- **THEN** selection skips it regardless of elapsed time, until it is re-enrolled

### Requirement: An empty pool fails explicitly
When no account in a member's pool is eligible, the service SHALL return an error identifying the condition rather than forwarding without a credential.

#### Scenario: All accounts cooling
- **WHEN** every account in a member's pool is `cooling`
- **THEN** the service returns a rate-limit response carrying the earliest cooldown expiry across the pool

#### Scenario: No accounts at all
- **WHEN** a member has no accounts and none are shared
- **THEN** the service returns an error stating that no account is available, distinct from a rate limit
