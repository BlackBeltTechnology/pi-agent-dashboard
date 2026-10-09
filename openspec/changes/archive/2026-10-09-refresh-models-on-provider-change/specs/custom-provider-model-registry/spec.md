## ADDED Requirements

### Requirement: Provider and credential changes SHALL reach the session model list without restart

A live session's model list SHALL reflect the current provider configuration (`providers.json`, `models.json`) and stored credentials (`auth.json`) without restarting the pi session. Opening the model selector SHALL be sufficient to resynchronize, even when the dashboard's change notification never reached the session. Opening the selector SHALL NOT fetch pi's remote model catalogues. Discovering the model list of a custom provider is permitted only when the re-sync detects that provider as added or changed. Concurrent re-syncs SHALL NOT return a model list before an in-flight provider registration completes.

#### Scenario: Provider added while notification was missed

- **WHEN** a provider is added to `providers.json`
- **AND** the session did not receive the change notification
- **AND** the user opens the model selector for that session
- **THEN** the returned model list SHALL include the new provider's models

#### Scenario: Provider removed while notification was missed

- **WHEN** a provider is removed from `providers.json`
- **AND** the session did not receive the change notification
- **AND** the user opens the model selector
- **THEN** the returned model list SHALL NOT include that provider's models

#### Scenario: Credential-only change notified

- **WHEN** a credential is stored for a built-in provider without any `providers.json` change
- **AND** the session receives the change notification
- **THEN** the model list pushed in response SHALL include that provider's models

#### Scenario: Selector open stays local

- **WHEN** the user opens the model selector
- **THEN** the resulting registry refresh SHALL NOT request pi's remote model catalogues
- **AND** when `providers.json` is unchanged, no provider model-discovery request SHALL be made

#### Scenario: Concurrent re-syncs wait for in-flight registration

- **WHEN** a provider re-sync is registering a newly added provider
- **AND** a second re-sync starts before that registration completes
- **THEN** the second re-sync SHALL complete only after the first registration completed
