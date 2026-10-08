## MODIFIED Requirements

### Requirement: LLM-only settings controls read/write the plugin config namespace `plugins.grammar`

The `GrammarSettings` component SHALL expose controls for the LLM-only grammar
config shape (`enabled`, `autoCheck`, `debounceMs`, `minChars`, `maxChars`,
`language`, a SINGLE model picker (direct model or, when the roles plugin is installed, a model role), `capitalizeFirstWord`, and `correctionView`
(`redline` | `list`, default `redline`) as a segmented **Correction view**
control), grouped into collapsible `<details>` accordion sections. It SHALL NOT
render a backend selector or a LanguageTool URL field. Values SHALL be read from
the plugin config namespace `plugins.grammar.*` (validated by the plugin
`configSchema`), NOT the core `config.grammar` block, and SHALL be persisted
through the host's unified Save Bar via `useSettingsDraftSource` (the section
SHALL NOT render its own Save/Reload buttons).

#### Scenario: Current values load from the plugin config
- **WHEN** the section mounts
- **THEN** it SHALL issue `GET /api/config` and populate every control from
  `data.plugins.grammar`
- **AND** if absent it SHALL show the disabled defaults (`enabled: false`,
  `autoCheck: true`, `debounceMs: 1200`, `minChars: 12`, `maxChars: 4000`,
  `language: "auto"`, `correctionView: "redline"`, `capitalizeFirstWord: false`,
  and no configured model)

#### Scenario: The model picker is always shown and required
- **WHEN** the section renders
- **THEN** a single model picker SHALL be shown (the `ui:model-selector`
  primitive fed by `GET /api/models`), with NO separate free-text
  `provider`/`model` fields and NO backend selector
- **WHEN** `plugins.grammar.llm` is unset (neither a direct model nor a role)
- **THEN** the section SHALL show a "pick a model" prompt indicating the feature
  cannot run until a model is chosen

#### Scenario: A persisted LanguageTool config renders as LLM-only
- **WHEN** `data.plugins.grammar` contains a legacy `backend`/`languagetool.url`
- **THEN** the section SHALL ignore both and render the LLM-only controls
- **AND** SHALL NOT surface a backend selector or a URL field

#### Scenario: Correction view control persists redline vs list
- **WHEN** the user sets **Correction view** to `list` (or `redline`) and the
  host Save Bar commits
- **THEN** the value SHALL be written as `plugins.grammar.correctionView` via
  `POST /api/config/plugins/grammar`
- **AND** a subsequent `GET /api/grammar/health` SHALL report the saved
  `correctionView`

#### Scenario: Save persists via the plugin config endpoint
- **WHEN** the section is edited and the host unified Save Bar commits the
  `plugin:grammar` draft source
- **THEN** the config SHALL be written via `POST /api/config/plugins/grammar`
  (auth-gated), NOT `PUT /api/config`
- **AND** a model pick SHALL persist as `llm: { provider, model }` within the
  plugin config, and a role pick SHALL persist as `llm: { role }` (a role ref
  `@<role>[:<level>]`); the two shapes SHALL be mutually exclusive

#### Scenario: Legacy core config is migrated in once
- **WHEN** the plugin server entry loads AND `plugins.grammar` is empty AND a
  legacy `config.grammar` block exists
- **THEN** the plugin SHALL copy it into `plugins.grammar` once (non-destructive
  read-through), dropping any `backend`/`languagetool` fields
- **AND** subsequent loads SHALL NOT re-migrate

#### Scenario: Section registers with the host unified Save Bar
- **WHEN** the section mounts
- **THEN** it SHALL register a `useSettingsDraftSource` with id `plugin:grammar`
  exposing `isDirty`, `commit`, and `reset`
- **AND** `isDirty` SHALL become true after any control is edited away from the
  loaded value and false again once the edit is reverted
- **AND** `reset` SHALL reload the persisted config, discarding edits

#### Scenario: Fields are grouped into collapsible accordions
- **WHEN** the section renders
- **THEN** its controls SHALL be organized into `<details>`/`<summary>`
  accordion groups
- **AND** every control that survives the redesign SHALL retain its existing
  `data-testid` (the removed `grammar-save`/`grammar-reload`/`grammar-dirty`
  controls excepted)

#### Scenario: A failed save keeps the section dirty
- **WHEN** the host Save Bar commits the `plugin:grammar` source and
  `POST /api/config/plugins/grammar` responds non-OK
- **THEN** `commit` SHALL reject (not resolve)
- **AND** the source SHALL remain dirty so the host reports the failure and
  allows retry (it SHALL NOT report a successful save)

## ADDED Requirements

### Requirement: The grammar model MAY follow a model role

The grammar model picker SHALL enable the model-selector Role tab. A role pick SHALL persist in the plugin config as a role ref (`@<role>[:<level>]`) alongside the existing direct `llm: { provider, model }` shape, and the plugin `configSchema` SHALL accept both. Each grammar check SHALL resolve a role ref at check time through the shared role resolver, so a role or preset change takes effect on the next check without re-saving grammar settings. An unresolved role SHALL fail the check with a distinct, user-visible "model role unassigned" outcome, never silently using another model.

#### Scenario: Role pick persists as a role ref
- **WHEN** the user picks `@fast` in the grammar model picker and the host Save Bar commits
- **THEN** the plugin config SHALL store the role ref `@fast` for the grammar model

#### Scenario: Preset change applies on the next check
- **GIVEN** the grammar model is `@fast`
- **WHEN** the active preset reassigns `fast` and a grammar check runs
- **THEN** the check SHALL use the newly assigned model

#### Scenario: Unassigned role fails visibly
- **WHEN** the grammar model is `@fast`, `fast` is unassigned, and a check runs
- **THEN** the check SHALL fail with a "model role unassigned" outcome naming `@fast`

#### Scenario: Direct model config is unchanged
- **WHEN** the persisted grammar model is a direct `llm: { provider, model }`
- **THEN** checks SHALL behave exactly as before this change
