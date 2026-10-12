## MODIFIED Requirements

### Requirement: OAuth token refresh SHALL propagate a concrete abort signal

pi 0.84.1 requires config-form extension OAuth `refreshToken(credentials, signal)` callbacks to accept and honor a concrete abort signal. The dashboard's internal auth storage SHALL pass a real `AbortSignal` to the runtime on every credential resolution it initiates (a ceiling, never a caller's signal), and the OAuth `refresh` callback SHALL receive a concrete `AbortSignal`, never the credentials argument alone.

From pi 1.1.0 the caller's signal cancels only the wait for the credential lock: a refresh that has started ignores it, is bounded by pi's own 15-second timeout, and persists the rotated credential, so a cancelled caller cannot discard the only valid refresh token. Accordingly the internal auth storage SHALL NOT tie its per-provider shared resolution to any caller's signal. Each caller SHALL wait only as long as its own signal allows, and a request whose signal is already aborted SHALL NOT start or join a resolution. See change: update-pi-core-1-1-adopt-apis.

A refresh failure SHALL NOT be silently swallowed. The request SHALL either fail with an error, or use a credential that another writer stored. The error is the refresh failure itself, or a more specific coordination outcome that explains it (the credential was removed, replaced, or corrupt). A stored credential is used only if, by the time of the failure, another writer has stored a different credential for the provider that is valid beyond the refresh buffer. Both cases are defined by "OAuth refresh SHALL coordinate with other auth.json writers". See change: harden-auth-json-lock-coordination.

#### Scenario: Refresh is invoked with a signal

- **WHEN** the internal auth storage refreshes an OAuth credential
- **THEN** it SHALL pass a concrete `AbortSignal` as the second argument to `refreshToken`

#### Scenario: A cancelled request does not discard a started refresh

- **WHEN** the request's signal aborts while an OAuth refresh is in flight
- **THEN** the request SHALL reject promptly with the abort reason
- **AND** the refresh SHALL NOT receive that signal and SHALL run to completion
- **AND** a rotated credential the refresh returns SHALL be persisted
- **AND** a request that arrives meanwhile SHALL join the same refresh, and a later one SHALL use the persisted credential, with the provider's refresh called exactly once

#### Scenario: A refresh that fails after the request was cancelled persists nothing

- **WHEN** the request's signal aborts while an OAuth refresh is in flight
- **AND** the refresh then rejects
- **THEN** `auth.json` SHALL be left byte-identical and the refresh SHALL NOT be retried for the cancelled request

#### Scenario: An already-cancelled request starts nothing

- **WHEN** the request's signal is already aborted
- **THEN** no refresh SHALL be started

#### Scenario: Refresh failure does not persist a broken credential

- **WHEN** an OAuth refresh rejects
- **AND** `auth.json` holds no different credential for the provider that is valid beyond the refresh buffer
- **THEN** the previously stored credential SHALL be left intact
- **AND** the failure SHALL be surfaced to the caller rather than silently swallowed
