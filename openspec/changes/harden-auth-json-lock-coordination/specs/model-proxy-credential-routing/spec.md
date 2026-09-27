## MODIFIED Requirements

### Requirement: OAuth token refresh SHALL propagate a concrete abort signal

pi 0.84.1 requires config-form extension OAuth `refreshToken(credentials, signal)` callbacks to accept and honor a concrete abort signal. The dashboard's internal auth storage SHALL pass a real `AbortSignal` on every OAuth refresh it initiates, and SHALL NOT call the callback with the credentials argument alone.

A refresh failure SHALL NOT be silently swallowed. The request SHALL either fail with an error, or use a credential that another writer stored. The error is the refresh failure itself, or a more specific coordination outcome that explains it (the credential was removed, replaced, or corrupt). A stored credential is used only if, by the time of the failure, another writer has stored a different credential for the provider that is valid beyond the refresh buffer. Both cases are defined by "OAuth refresh SHALL coordinate with other auth.json writers". See change: harden-auth-json-lock-coordination.

#### Scenario: Refresh is invoked with a signal

- **WHEN** the internal auth storage refreshes an OAuth credential
- **THEN** it SHALL pass a concrete `AbortSignal` as the second argument to `refreshToken`

#### Scenario: Aborted refresh stops cleanly

- **WHEN** the supplied signal aborts while an OAuth refresh is in flight
- **THEN** the refresh SHALL stop
- **AND** no partially-refreshed credential SHALL be persisted

#### Scenario: Refresh failure does not persist a broken credential

- **WHEN** an OAuth refresh rejects
- **AND** `auth.json` holds no different credential for the provider that is valid beyond the refresh buffer
- **THEN** the previously stored credential SHALL be left intact
- **AND** the failure SHALL be surfaced to the caller rather than silently swallowed

## ADDED Requirements

### Requirement: OAuth refresh SHALL coordinate with other auth.json writers
The dashboard's internal auth storage shares `auth.json` with pi processes that refresh the same OAuth credentials. When a credential needs refreshing (it expires within the refresh buffer), the internal auth storage SHALL take its starting point from a read of `auth.json` performed under the `auth.json` lock, not from its in-memory snapshot. That read SHALL follow the existing corrupt-content read tolerance (quarantine, never throw on content). Corrupt content SHALL fail the refresh, not the read. It SHALL NOT hold the lock across its own network refresh.

Persisting a refreshed credential SHALL be a compare-and-swap under the lock. The write SHALL happen only if the stored credential is equal, in every field, to the credential the refresh started from. Otherwise nothing SHALL be written and:
- a stored OAuth credential that is valid beyond the refresh buffer SHALL be used;
- any other outcome SHALL fail the request with an error naming the outcome: changed-and-expired, removed, replaced by a non-OAuth credential, corrupt (unparseable) content, or lock contention after the refresh path's window is exhausted.

A credential removed while a refresh was in flight SHALL NOT be recreated. Neither the credential nor `auth.json` itself SHALL be created by this path: an absent `auth.json` is the removed outcome. Corrupt `auth.json` content SHALL NOT be written over by a refresh. A refreshed credential that could not be persisted SHALL NOT be used for the request. Lock waits on this path SHALL be non-blocking and SHALL be bounded by a window that exceeds pi's OAuth refresh timeout (a 15-second abort signal as of pi 0.86.1) and stays below the lock staleness threshold. No credential material SHALL appear in any error message or log line produced by this coordination. See change: harden-auth-json-lock-coordination.

#### Scenario: Fresher on-disk credential is adopted without a refresh
- **WHEN** the in-memory credential for a provider expires within the refresh buffer but `auth.json` holds an OAuth credential for it that is valid beyond the refresh buffer, written by another process
- **THEN** the internal auth storage SHALL use the on-disk credential for the request
- **AND** SHALL NOT call the provider's refresh

#### Scenario: Waiting out a concurrent pi refresh avoids a second refresh
- **WHEN** a refresh is needed while another process holds the `auth.json` lock for several seconds (longer than the interactive 2-second window) and stores a fresh credential before releasing it
- **THEN** the internal auth storage SHALL wait for the lock rather than fail
- **AND** SHALL adopt the stored credential without calling the provider's refresh

#### Scenario: Refresh spends the on-disk refresh token
- **WHEN** a refresh is needed and the on-disk credential's refresh token differs from the in-memory one
- **THEN** the refresh SHALL be invoked with the on-disk credential's refresh token

#### Scenario: Unchanged credential is replaced by the refreshed one
- **WHEN** a refresh completes and the stored credential is equal in every field to the one the refresh started from
- **THEN** the refreshed credential SHALL be written to `auth.json` and used for the request

#### Scenario: Credential changed during the refresh is not overwritten
- **WHEN** another writer stores a different OAuth credential for the provider, valid beyond the refresh buffer, while the dashboard's refresh is in flight
- **THEN** the dashboard SHALL NOT write its refreshed credential
- **AND** the stored credential SHALL remain byte-identical in `auth.json` and SHALL be used for the request

#### Scenario: A change to a non-token field is not overwritten
- **WHEN** another writer changes only a non-token field of the provider's credential (for example `enterpriseUrl` or `expires`) while the dashboard's refresh is in flight
- **THEN** the dashboard SHALL NOT write its refreshed credential over it

#### Scenario: Changed but expired credential fails diagnosably
- **WHEN** the stored credential changed during the refresh and is not valid beyond the refresh buffer
- **THEN** nothing SHALL be written
- **AND** the request SHALL fail with an error stating the credential changed during the refresh

#### Scenario: Credential removed during the refresh is not resurrected
- **WHEN** the provider's credential is removed from `auth.json` while the dashboard's refresh is in flight
- **THEN** `auth.json` SHALL NOT contain a credential for that provider afterwards
- **AND** the request SHALL fail with an error stating the credential was removed

#### Scenario: Credential replaced by an api key during the refresh
- **WHEN** the provider's OAuth credential is replaced by an `api_key` credential while the dashboard's refresh is in flight
- **THEN** the stored `api_key` credential SHALL remain unchanged
- **AND** the request SHALL fail with an error stating the credential was replaced, without using the api key as an OAuth token

#### Scenario: Corrupt auth.json is not written over by a refresh
- **WHEN** `auth.json` holds unparseable content at snapshot or persist time
- **THEN** the refresh SHALL NOT write `auth.json`
- **AND** the request SHALL fail with an error identifying corrupt content, distinct from the removal error

#### Scenario: Absent auth.json is not created by a refresh
- **WHEN** a refresh is needed and `auth.json` does not exist
- **THEN** `auth.json` SHALL still not exist afterwards
- **AND** the request SHALL fail with the removal error

#### Scenario: Persist blocked past the refresh window discards the minted credential
- **WHEN** the network refresh succeeds but the `auth.json` lock stays held past the refresh path's window at persist time
- **THEN** nothing SHALL be written
- **AND** the request SHALL fail with a lock-contention error rather than use the unpersisted credential

#### Scenario: Failed refresh recovers from a concurrently stored credential
- **WHEN** the provider rejects the dashboard's refresh and, by the time of the rejection, `auth.json` holds a different OAuth credential that is valid beyond the refresh buffer
- **THEN** the internal auth storage SHALL use the stored credential for the request instead of surfacing the refresh failure

#### Scenario: Failed refresh explained by a concurrent removal
- **WHEN** the provider rejects the dashboard's refresh and, by the time of the rejection, the credential has been removed from `auth.json`
- **THEN** the request SHALL fail with the removal error rather than the provider's rejection
- **AND** `auth.json` SHALL NOT contain a credential for that provider

#### Scenario: Network refresh does not hold the auth.json lock
- **WHEN** an OAuth refresh is in flight for the internal auth storage
- **THEN** a concurrent dashboard credential write for a different provider SHALL acquire the `auth.json` lock and complete without waiting for the refresh to finish
