## ADDED Requirements

### Requirement: A refused CORS origin is observable

A CORS origin refusal SHALL be recorded in the denial ledger so it is visible to a trusted client, rather than surfacing only as an opaque browser-side failure with no server-side trace.

#### Scenario: Refused origin is recorded

- **WHEN** an origin is refused by the CORS decision
- **THEN** a ledger entry SHALL record the refusal with the refused origin

#### Scenario: Recording does not alter the CORS decision

- **WHEN** a refusal is recorded
- **THEN** the CORS response SHALL be unchanged
- **AND** allowed origins SHALL be unaffected

### Requirement: Allowed CORS origins are reviewable and revocable

Configured CORS origins SHALL be listed in `Settings → Access` with a revoke action that removes them through the existing configuration write path. Origins that are allowed structurally rather than by configuration — loopback, the active tunnel URL, and the neutral shell origin — SHALL be shown as non-revocable rather than offered a revoke action that could not take effect.

#### Scenario: Configured origins are listed and revocable

- **WHEN** the Access page is opened and CORS origins are configured
- **THEN** each configured origin SHALL be listed with a revoke action

#### Scenario: Structural allowances are shown as non-revocable

- **WHEN** an origin is allowed because it is loopback, the active tunnel URL, or the neutral shell origin
- **THEN** it SHALL be presented without a revoke action
