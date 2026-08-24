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
Each account SHALL hold state `ok`, `cooling`, or `dead`. When rotation is enabled, selection SHALL consider only accounts in `ok`. When rotation is disabled, selection is confined to the member's primary and SHALL attempt it even while `cooling` — with no alternative to move to, skipping on a cooldown estimate would strand the member for the length of a guess.

#### Scenario: Cooling primary is attempted when rotation is off
- **WHEN** rotation is disabled and the member's primary account is `cooling`
- **THEN** the request is still forwarded on that account rather than failed on the strength of a cooldown estimate

#### Scenario: Dead primary is not attempted when rotation is off
- **WHEN** rotation is disabled and the member's primary account is `dead`
- **THEN** the service returns an error distinguishable from a rate limit, so a retrying client does not hammer an account that has no usable token

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
- **THEN** the service returns a rate-limit response carrying the earliest cooldown expiry across the pool, rather than optimistically spending a request on the least-recently-cooled account

#### Scenario: An implausible retry-after is clamped
- **WHEN** an upstream 429 carries a `retry-after` far beyond the configured ceiling
- **THEN** the cooldown applied is the ceiling, so one hostile or erroneous header cannot remove an account from the pool for days

#### Scenario: Selection order differs between members
- **WHEN** two members whose pools contain the same shared accounts are rate-limited at the same moment
- **THEN** their rotation walks do not traverse those accounts in the same order, so a team-wide event does not concentrate every retry on the same upstream account first

#### Scenario: No accounts at all
- **WHEN** a member has no accounts and none are shared
- **THEN** the service returns an error stating that no account is available, distinct from a rate limit
