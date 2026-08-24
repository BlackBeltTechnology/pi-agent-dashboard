# grammar-settings-plugin Specification

## MODIFIED Requirements

### Requirement: Settings controls read/write the plugin config namespace `plugins.grammar`

The `GrammarSettings` component SHALL expose controls for the full grammar config shape
(`enabled`, `autoCheck`, `backend` (`languagetool` | `llm`), `debounceMs`, `minChars`, `maxChars`,
`language`, `languagetool.url`, a SINGLE model picker when `backend === "llm"`, and
`correctionView` (`redline` | `list`, default `redline`) as a segmented **Correction view**
control). Values SHALL be read from and written to the plugin config namespace
`plugins.grammar.*` (validated by the plugin `configSchema`), NOT the core `config.grammar`
block.

#### Scenario: Current values load from the plugin config
- **WHEN** the section mounts
- **THEN** it SHALL issue `GET /api/config` and populate every control from `data.plugins.grammar`
- **AND** if absent it SHALL show the disabled defaults (`enabled: false`,
  `backend: "languagetool"`, `autoCheck: true`, `debounceMs: 1200`, `minChars: 12`,
  `maxChars: 4000`, `language: "auto"`, `languagetool.url: "http://localhost:8081"`,
  `correctionView: "redline"`)

#### Scenario: A single model selector is used for the llm backend
- **WHEN** `backend` is `languagetool`
- **THEN** no model selector SHALL be shown
- **WHEN** `backend` is `llm`
- **THEN** a single model picker SHALL be shown (the `ui:model-selector` primitive fed by
  `GET /api/models`), with NO separate free-text `provider`/`model` fields

#### Scenario: Correction view control persists redline vs list
- **WHEN** the user sets **Correction view** to `list` (or `redline`) and clicks Save
- **THEN** the value SHALL be written as `plugins.grammar.correctionView` via
  `POST /api/config/plugins/grammar`
- **AND** a subsequent `GET /api/grammar/health` SHALL report the saved `correctionView`

#### Scenario: Save persists via the plugin config endpoint
- **WHEN** the user edits controls and clicks Save
- **THEN** the config SHALL be written via `POST /api/config/plugins/grammar` (auth-gated),
  NOT `PUT /api/config`
- **AND** an `llm` model pick SHALL persist as `llm: { provider, model }` within the plugin config

#### Scenario: Legacy core config is migrated in once
- **WHEN** the plugin server entry loads AND `plugins.grammar` is empty AND a legacy
  `config.grammar` block exists
- **THEN** the plugin SHALL copy it into `plugins.grammar` once (non-destructive read-through)
- **AND** subsequent loads SHALL NOT re-migrate
