# Spec Delta

## ADDED Requirements

### Requirement: Claude subscription compat toggle persisted in preferences
The system SHALL persist a global boolean `claudeSubscriptionCompat` in `preferences.json`, defaulting to `false` when absent, with the same debounced atomic writes as the other preferences. The value SHALL be relayed to bridge extensions on register and on every change, alongside `autoNameSessions`.

#### Scenario: Default when absent
- **WHEN** `preferences.json` has no `claudeSubscriptionCompat` field
- **THEN** the system SHALL treat it as `false`

#### Scenario: Toggle persisted
- **WHEN** the user turns the compat switch on from any dashboard surface
- **THEN** `claudeSubscriptionCompat` SHALL be written as `true` in `preferences.json`

#### Scenario: Relayed to bridges
- **WHEN** the value changes
- **THEN** every connected bridge SHALL receive the new value in a preferences update
- **AND** a bridge that registers later SHALL receive the current value on register
