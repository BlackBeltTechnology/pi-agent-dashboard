## ADDED Requirements

### Requirement: OAuth refresh SHALL survive relocation of the runtime's OAuth entry point

Credential refresh for OAuth-credentialed providers SHALL continue to work when the pi-ai runtime moves its OAuth implementation, and SHALL fail diagnosably rather than crashing when no implementation is reachable.

#### Scenario: Refresh works after relocation

- **WHEN** the resolved runtime exposes its OAuth implementation somewhere other than the legacy entry point
- **AND** a stored OAuth credential needs refreshing
- **THEN** the refresh SHALL succeed
- **AND** the refreshed credential SHALL be used for the upstream request

#### Scenario: Empty OAuth entry point does not crash the credential path

- **WHEN** the runtime's legacy OAuth entry point loads but exposes no usable functions
- **THEN** the credential path SHALL NOT raise a type error
- **AND** the condition SHALL be reported as a missing OAuth capability

#### Scenario: api-key providers are unaffected by missing OAuth

- **WHEN** no usable OAuth implementation is reachable
- **THEN** models whose provider has an api-key credential SHALL remain routable
- **AND** only OAuth-credentialed models SHALL be reported as unavailable

#### Scenario: OAuth-incompatible filtering is preserved

- **WHEN** a provider holds only an OAuth credential
- **THEN** models flagged OAuth-incompatible SHALL continue to be excluded from the available set exactly as specified today
