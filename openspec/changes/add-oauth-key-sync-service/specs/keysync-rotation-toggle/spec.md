## ADDED Requirements

### Requirement: Rotation is gated by an admin switch and a member switch
The service SHALL rotate only when both the global admin rotation setting and the requesting member's rotation setting are enabled. Both settings SHALL default to enabled.

#### Scenario: Both enabled
- **WHEN** both the admin and member rotation settings are enabled and a rate limit occurs
- **THEN** the service rotates to the next eligible account

#### Scenario: Admin disabled overrides an enabled member setting
- **WHEN** the admin setting is disabled and a member's own setting is enabled
- **THEN** no rotation occurs for that member's requests

#### Scenario: Member disabled with admin enabled
- **WHEN** the admin setting is enabled and a member has disabled their own setting
- **THEN** no rotation occurs for that member's requests, while other members continue to rotate

### Requirement: With rotation off, only the primary account is used
When rotation is not in effect for a request, selection SHALL be confined to the member's primary account and a provider rate limit SHALL be returned to the client unchanged.

#### Scenario: Rate limit is passed through
- **WHEN** rotation is off and the primary account returns a rate limit
- **THEN** the rate-limit response is returned to the client and no other account is tried

#### Scenario: Cooling primary is still attempted
- **WHEN** rotation is off and the member's primary account is `cooling`
- **THEN** the request is still forwarded on the primary account rather than short-circuited

#### Scenario: Dead primary is an explicit error
- **WHEN** rotation is off and the member's primary account is `dead`
- **THEN** the service returns an error identifying the unusable account, distinct from a rate limit

### Requirement: Health is recorded regardless of the toggle
The service SHALL record account health transitions from observed upstream responses whether or not rotation is in effect.

#### Scenario: Cooling recorded with rotation off
- **WHEN** rotation is off and an upstream rate limit occurs
- **THEN** the account is still marked `cooling` and the pool view reflects it, while selection continues to use the primary

### Requirement: Setting changes take effect at the next request
The service SHALL read both rotation settings at request time, so a change applies without restarting a session.

#### Scenario: Admin disables rotation during an incident
- **WHEN** an admin disables the global rotation setting while members have sessions running
- **THEN** the next request from each member forgoes rotation, with no session restart required

### Requirement: Enforcement is server-side
The service SHALL enforce both rotation settings within its own selection path and SHALL NOT rely on any client-supplied value to determine whether rotation occurs.

#### Scenario: Client cannot request rotation while disabled
- **WHEN** a client sends a request containing a parameter or header asserting that rotation should occur, while the admin setting is disabled
- **THEN** no rotation occurs
