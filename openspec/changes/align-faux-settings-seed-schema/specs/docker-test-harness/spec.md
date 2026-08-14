## ADDED Requirements

### Requirement: The faux seed writes pi's startup default model as a split provider/model pair

When the harness seeds pi's own `~/.pi/agent/settings.json` under `PI_E2E_SEED`,
it SHALL write the default model as the split pair `defaultProvider` +
`defaultModel` (the schema pi reads at startup) rather than a legacy combined
`"provider/model"` string, so the faux model resolves at pi startup without
depending on a later correction. The seed SHALL remain non-clobbering: each key
is written only when absent, and an existing value is preserved.

#### Scenario: Seed emits the split faux pair on a fresh settings file

- **WHEN** the harness seeds `settings.json` for a container with no prior pi
  default-model configuration
- **THEN** the written file SHALL contain `defaultProvider: "faux"`
- **AND** the written file SHALL contain `defaultModel: "faux-1"`
- **AND** it SHALL NOT write the combined `defaultModel: "faux/faux-1"` string

#### Scenario: Existing default-model config is preserved

- **WHEN** the harness seed runs against a `settings.json` that already carries a
  `defaultProvider` or `defaultModel` value
- **THEN** the existing value SHALL be preserved (the seed only fills an absent
  key)
