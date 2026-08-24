## ADDED Requirements

### Requirement: Security-relevant events are recorded append-only
The service SHALL record enrolment, visibility change, role change, key issue and revoke, refresh outcome, account state transition, and rotation as append-only audit entries.

#### Scenario: Entry cannot be altered
- **WHEN** an audit entry has been written
- **THEN** no service operation modifies or deletes it

#### Scenario: Rotation is recorded with both accounts
- **WHEN** a request rotates from one account to another
- **THEN** the audit record identifies the rate-limited account, the account that served the request, and the member

### Requirement: Entries are attributable
Every audit entry SHALL identify the acting member where one exists, and the affected account where one exists.

#### Scenario: Service-initiated action is attributed to the service
- **WHEN** the refresher acts without a member request
- **THEN** the entry attributes the action to the service rather than to an arbitrary member

### Requirement: Audit entries contain no credential material
The service SHALL NOT record access tokens, refresh tokens, or member key plaintext in the audit log.

#### Scenario: Enrolment entry omits the credential
- **WHEN** an account is enrolled
- **THEN** the audit entry identifies the account and owner without containing the credential
