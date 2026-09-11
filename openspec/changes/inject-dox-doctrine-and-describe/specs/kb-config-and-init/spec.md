## MODIFIED Requirements

### Requirement: Layered configuration resolution
The KB SHALL resolve its effective configuration by layering three sources in precedence order: built-in defaults (lowest), the global file `~/.pi/dashboard/knowledge_base.json`, then the project file `.pi/dashboard/knowledge_base.json` (highest). The resolved config SHALL record its origin as `project`, `global`, or `defaults` based on the highest layer that supplied a file. The resolved config SHALL additionally record `doctrineSource` as `project`, `global`, or `none` — the highest layer that supplied a `doctrine` key — so callers can distinguish an explicit choice from defaults.

#### Scenario: No config files present
- **WHEN** neither the project file nor the global file exists
- **THEN** the effective config equals the built-in defaults
- **AND** the origin is `defaults`

#### Scenario: Only global file present
- **WHEN** the global file exists but the project file does not
- **THEN** fields from the global file override defaults and absent fields fall back to defaults
- **AND** the origin is `global`

#### Scenario: Project file present
- **WHEN** the project file exists
- **THEN** its fields take precedence over the global file and defaults
- **AND** the origin is `project`

#### Scenario: Explicit config path override
- **WHEN** an explicit config path is supplied
- **THEN** that file is read as the project layer instead of `.pi/dashboard/knowledge_base.json`

#### Scenario: Doctrine key unset in every layer
- **WHEN** neither file supplies a `doctrine` key
- **THEN** `doctrine` resolves to `{ inject: "kb", write: false }`
- **AND** `doctrineSource` is `none`

#### Scenario: Doctrine key supplied by the global file only
- **WHEN** only the global file supplies `doctrine`
- **THEN** `doctrineSource` is `global`

### Requirement: Deep-merge of nested option groups
The KB SHALL merge layers left-to-right, and for the known nested option groups (`chunking`, `dedup`, `graph`, `directoryLevelAgents`, `ranking`, `expand`, `rerank`, `queryExpansion`, `doctrine`) SHALL fill in fields one level deep rather than replacing the whole group. All other keys SHALL be replaced wholesale by a later layer.

#### Scenario: Partial nested group keeps sibling defaults
- **WHEN** a layer sets only `ranking.proximityBoost` to false
- **THEN** the resolved `ranking` retains the default `fieldWeights` and `diversity` values while `proximityBoost` is false

#### Scenario: Non-nested key replaced wholesale
- **WHEN** a later layer supplies a top-level array or scalar key (e.g. `exclude`)
- **THEN** that value replaces the earlier layer's value entirely rather than merging

#### Scenario: Project sets only doctrine.write
- **WHEN** the global file sets `doctrine.inject: "kb"` and the project file sets only `doctrine.write: true`
- **THEN** the resolved `doctrine` is `{ inject: "kb", write: true }`

### Requirement: Configuration validation
The KB SHALL validate the merged configuration shape and throw a precise error when a constraint is violated. The validated constraints SHALL be: `sources` is an array; each source has a string `ref`; each source `kind` is one of `filesystem`, `npm`, `git`, `https` (defaulting to `filesystem` when omitted); `maxFileCount` is a number or null; `dbPath` is a non-empty string; `queryExpansion.mode` is one of `off`, `prf`, `synonym`, `agent`; `doctrine.inject` is one of `kb`, `off`; and `doctrine.write` is a boolean.

#### Scenario: Source missing ref
- **WHEN** a source entry lacks a string `ref`
- **THEN** validation throws an error indicating each source needs a string `ref`

#### Scenario: Unknown source kind
- **WHEN** a source declares a `kind` outside the allowed set
- **THEN** validation throws an error naming the unknown kind

#### Scenario: Unknown query-expansion mode
- **WHEN** `queryExpansion.mode` is a value outside `off`/`prf`/`synonym`/`agent`
- **THEN** validation throws an error naming the unknown mode

#### Scenario: Malformed JSON in a config file
- **WHEN** a config file exists but contains invalid JSON
- **THEN** loading throws an error identifying the offending file path

#### Scenario: Unknown doctrine inject mode
- **WHEN** `doctrine.inject` is a value outside `kb`/`off`
- **THEN** validation throws an error naming the unknown mode
