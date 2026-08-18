## ADDED Requirements

### Requirement: Tokens are refreshed before expiry
The service SHALL refresh each enrolled OAuth account's access token before it expires, and SHALL persist the rotated refresh token atomically.

#### Scenario: Refresh ahead of expiry
- **WHEN** an enrolled account's access token approaches its expiry
- **THEN** the refresher obtains a new token and stores it before the old one expires

#### Scenario: Rotated refresh token is persisted atomically
- **WHEN** a provider returns a new refresh token alongside the access token
- **THEN** both are persisted in a single atomic write, so a crash cannot leave the stored refresh token stale

### Requirement: Exactly one refresher acts on an account
The service SHALL guarantee that no two refresh operations run concurrently against the same account, including across process instances sharing a database.

#### Scenario: Second instance is rejected at startup
- **WHEN** a second service instance starts against a database whose refresher ownership is already held by a live instance
- **THEN** the second instance refuses to start its refresher rather than refreshing in parallel

#### Scenario: Concurrent in-process refreshes are serialized
- **WHEN** two operations within one instance both determine that the same account needs refreshing
- **THEN** the refresh executes once and both operations observe the same resulting credential

### Requirement: Refresh failure marks the account dead
The service SHALL move an account to `dead` when its refresh fails irrecoverably, and SHALL exclude it from selection until its owner re-enrols it.

#### Scenario: Refresh token rejected by provider
- **WHEN** the provider rejects the stored refresh token
- **THEN** the account transitions to `dead`, the owner is attributed in the audit record, and selection skips it

#### Scenario: Transient network failure does not kill the account
- **WHEN** a refresh attempt fails with a network error rather than a provider rejection
- **THEN** the account remains in its current state and the refresh is retried
