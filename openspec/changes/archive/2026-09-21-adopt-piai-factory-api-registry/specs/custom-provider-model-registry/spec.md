## ADDED Requirements

### Requirement: Built-in models SHALL come from the installed pi-ai runtime

The built-in model set the server exposes SHALL be the catalogue of the pi-ai runtime actually resolved at run time, not a catalogue frozen at a minimum supported version. Registry construction SHALL succeed regardless of which supported runtime generation is resolved.

#### Scenario: Catalogue tracks the resolved runtime

- **WHEN** the resolved pi-ai runtime's built-in catalogue contains a model
- **AND** that model's provider has a usable credential
- **THEN** `GET /api/models` SHALL include that model

#### Scenario: Newer runtime is not rejected

- **WHEN** the resolved runtime exposes the factory API rather than the global-registry API
- **THEN** the server model registry SHALL still be constructible
- **AND** `GET /api/models` SHALL respond `200` rather than `503 MODEL_PROXY_RUNTIME_MISSING`

#### Scenario: Custom and native model composition is unaffected

- **WHEN** the built-in catalogue is sourced from either supported runtime generation
- **THEN** discovery-sourced custom-provider models, native `models.json` metadata precedence, credential filtering, and `provider/id` deduplication SHALL behave exactly as specified for the existing registry

### Requirement: Registry composition SHALL NOT be perturbed by how built-ins are sourced

The mechanism used to obtain built-in models from the resolved runtime SHALL NOT change which entries the registry's composition pass sees, nor which entry wins deduplication.

#### Scenario: Custom providers do not enter the built-in pass

- **WHEN** the registry composes built-in models with custom-provider models
- **THEN** a custom provider SHALL NOT be enumerated as a built-in provider by the runtime surface
- **AND** the native `models.json` capability projection for that provider's models SHALL be the one retained

#### Scenario: Built-in still wins over a same-named custom entry

- **WHEN** a custom entry declares the same `provider/id` as a built-in model
- **THEN** the built-in model SHALL win deduplication exactly as specified today
