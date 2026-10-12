## ADDED Requirements

### Requirement: Explicit provider refresh SHALL re-discover a provider in every live session

When a session receives `credentials_updated` naming providers in `refreshProviders`, it SHALL treat each named provider still present in `providers.json` as changed, even when its connection details are unchanged: drop its registration, re-register it (re-fetching its `/models` list and re-reading its native `models.json` entries), and push a fresh model list. Names absent from `providers.json` SHALL be ignored. Providers not named SHALL NOT be re-discovered. A `credentials_updated` without `refreshProviders` SHALL behave exactly as before. Opening the model selector SHALL remain local-only.

#### Scenario: Endpoint model list changed

- **WHEN** `proxy`'s `/models` endpoint adds model `new-model` while `providers.json` is unchanged
- **AND** the session receives `credentials_updated` with `refreshProviders: ["proxy"]`
- **THEN** the pushed model list SHALL include `proxy/new-model`

#### Scenario: Endpoint model removed

- **WHEN** `proxy`'s endpoint stops listing `old-model`
- **AND** the session receives `credentials_updated` with `refreshProviders: ["proxy"]`
- **THEN** the pushed model list SHALL NOT include `proxy/old-model`

#### Scenario: Only the named provider is re-discovered

- **WHEN** `proxy` and `vllm` are registered and the session receives `refreshProviders: ["proxy"]`
- **THEN** exactly one provider model-discovery request SHALL be made, to `proxy`

#### Scenario: Unknown name is ignored

- **WHEN** the session receives `refreshProviders: ["missing"]` and `missing` is not in `providers.json`
- **THEN** no discovery request SHALL be made and no error SHALL be raised

#### Scenario: Plain notification unchanged

- **WHEN** the session receives `credentials_updated` without `refreshProviders` and `providers.json` is unchanged
- **THEN** no provider model-discovery request SHALL be made
