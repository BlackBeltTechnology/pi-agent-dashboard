## ADDED Requirements

### Requirement: Tokens are refreshed before expiry
The service SHALL refresh each enrolled OAuth account's access token before it expires, and SHALL persist the rotated refresh token atomically.

#### Scenario: Refresh ahead of expiry
- **WHEN** an enrolled account's access token approaches its expiry
- **THEN** the refresher obtains a new token and stores it before the old one expires

#### Scenario: Rotated refresh token is persisted atomically
- **WHEN** a provider returns a new refresh token alongside the access token
- **THEN** both are persisted in a single atomic write, so a crash cannot leave the stored refresh token stale

#### Scenario: A refresh response arriving after its deadline is still persisted
- **WHEN** a refresh request exceeds its timeout and the response arrives afterwards carrying a valid rotated token
- **THEN** the token is persisted rather than discarded — because the provider may already have consumed the old refresh token, discarding the new one would strand the account permanently, and its owner is offline by design

#### Scenario: An account needing re-authorisation is surfaced to its owner
- **WHEN** a refresh fails in a way that leaves no usable credential
- **THEN** the account is flagged as needing re-authorisation and its owner is notified out-of-band, rather than the account silently ceasing to work

### Requirement: Exactly one refresher acts on an account
The service SHALL guarantee that no two refresh operations run concurrently against the same account, including across process instances sharing a database.

#### Scenario: Second instance is rejected while the lease is live
- **WHEN** a second service instance starts against a database whose refresher lease is held and being renewed by a live instance
- **THEN** the second instance refuses to start its refresher rather than refreshing in parallel

#### Scenario: A lease abandoned by a killed instance expires without intervention
- **WHEN** an instance holding the refresher lease is terminated without releasing it, and a replacement starts
- **THEN** the replacement acquires the lease once it expires and begins refreshing, with no operator action — an unattended restart must not require a human to clear a stale lock

#### Scenario: A stalled instance loses the lease it stopped renewing
- **WHEN** an instance stops renewing its lease but is still running, and another instance acquires it
- **THEN** the stalled instance does not resume refreshing on the strength of its expired lease

#### Scenario: Concurrent in-process refreshes are serialized
- **WHEN** two operations within one instance both determine that the same account needs refreshing
- **THEN** the refresh executes once and both operations observe the same resulting credential

### Requirement: Refresh failure marks the account dead
The service SHALL move an account to `dead` when its refresh fails irrecoverably, and SHALL exclude it from selection until its owner re-authorises or removes and re-enrols it.

#### Scenario: Refresh token rejected by provider
- **WHEN** the provider rejects the stored refresh token
- **THEN** the account transitions to `dead`, the owner is attributed in the audit record, and selection skips it

#### Scenario: Transient network failure does not kill the account
- **WHEN** a refresh attempt fails with a network error rather than a provider rejection
- **THEN** the account remains in its current state and the refresh is retried

### Requirement: The forwarding path does not refresh independently
The request path SHALL NOT perform its own refresh. When a selected account's token is stale, the forwarding path SHALL obtain a fresh credential through the same single writer, so that no second refresh trigger exists in the process.

#### Scenario: A stale token at selection time is refreshed through the one writer
- **WHEN** a request selects an account whose access token is expired or within its pre-expiry window
- **THEN** the credential is refreshed via the refresher rather than by the request path itself, and the request proceeds on the fresh token

#### Scenario: An upstream 401 is not treated as a rate limit
- **WHEN** a forwarded request returns 401 on a credential the refresher considers current
- **THEN** the account transitions to `dead` rather than `cooling`, because the credential is bad rather than throttled
