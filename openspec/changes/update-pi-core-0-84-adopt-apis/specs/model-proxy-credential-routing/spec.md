## ADDED Requirements

### Requirement: OAuth token refresh SHALL propagate a concrete abort signal

pi 0.84.0 requires config-form extension OAuth `refreshToken(credentials, signal)` callbacks to accept and honor a concrete abort signal. The dashboard's internal auth storage SHALL pass a real `AbortSignal` on every OAuth refresh it initiates, and SHALL NOT call the callback with the credentials argument alone.

#### Scenario: Refresh is invoked with a signal

- **WHEN** the internal auth storage refreshes an OAuth credential
- **THEN** it SHALL pass a concrete `AbortSignal` as the second argument to `refreshToken`

#### Scenario: Aborted refresh stops cleanly

- **WHEN** the supplied signal aborts while an OAuth refresh is in flight
- **THEN** the refresh SHALL stop
- **AND** no partially-refreshed credential SHALL be persisted

#### Scenario: Refresh failure does not persist a broken credential

- **WHEN** an OAuth refresh rejects
- **THEN** the previously stored credential SHALL be left intact
- **AND** the failure SHALL be surfaced to the caller rather than silently swallowed
