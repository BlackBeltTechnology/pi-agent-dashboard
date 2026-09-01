## ADDED Requirements

### Requirement: Plugin manifest claims the settings-section slot

The `grammar-settings` plugin SHALL be a first-party package under `packages/*` whose
`package.json` carries a `pi-dashboard-plugin` manifest with `id: "grammar-settings"`,
`priority: 100`, a `client` entry, and exactly one claim
`{ slot: "settings-section", component: "GrammarSettings", tab: "general" }`. The plugin
SHALL be discovered automatically by the vite plugin + server loader (scanning
`packages/*/package.json`) with no edit to any core registry. The plugin SHALL declare no
`server` entry and no `configSchema`.

#### Scenario: Manifest is discovered and generates a registry entry
- **WHEN** the plugin package exists under `packages/grammar-settings-plugin/` with its
  manifest
- **THEN** the vite plugin SHALL include it in the generated
  `packages/client/src/generated/plugin-registry.tsx`
- **AND** the claim SHALL target the `settings-section` slot with component `GrammarSettings`

#### Scenario: Section renders under the plugin's row on the General tab
- **WHEN** the plugin is enabled and the Settings page General tab is open
- **THEN** the `GrammarSettings` component SHALL render under the plugin's own row
- **AND** it SHALL appear below the core settings sections (plugin contributions sort after
  core, then by priority)

#### Scenario: Disabled plugin contributes nothing
- **WHEN** the `grammar-settings` plugin is disabled in config
- **THEN** no `GrammarSettings` section SHALL render
- **AND** the plugin's gear SHALL be inert (per the shared plugin-loader disabled behaviour)

### Requirement: Settings controls are bound to the core `config.grammar` block

The `GrammarSettings` component SHALL expose controls for the full `GrammarConfig` shape:
`enabled` and `autoCheck` (toggles), `backend` (`languagetool` | `llm` select), `debounceMs`,
`minChars`, `maxChars` (numeric), `language` (default `auto`), `languagetool.url`, and — when
`backend === "llm"` — a SINGLE model picker (not separate provider + model fields). Values
SHALL be read from the core `config.grammar` block, NOT from a `plugins.<id>.*` namespace.

#### Scenario: Current values load from GET /api/config
- **WHEN** the section mounts
- **THEN** it SHALL issue `GET /api/config` and populate every control from the returned
  `grammar` block
- **AND** if `grammar` is absent it SHALL show the disabled defaults (`enabled: false`,
  `backend: "languagetool"`, `autoCheck: true`, `debounceMs: 1200`, `minChars: 12`,
  `maxChars: 4000`, `language: "auto"`, `languagetool.url: "http://localhost:8081"`)

#### Scenario: A single model selector is used for the llm backend
- **WHEN** `backend` is set to `languagetool`
- **THEN** no model selector SHALL be shown
- **WHEN** `backend` is set to `llm`
- **THEN** a single model picker SHALL be shown (obtained via the dashboard
  `ui:model-selector` primitive, fed by the resolved `GET /api/models` catalog)
- **AND** there SHALL NOT be separate free-text `provider` and `model` fields

#### Scenario: A model pick persists as core `llm.{provider, model}`
- **WHEN** the user picks a model whose label is `"<provider>/<id>"`
- **AND** clicks Save
- **THEN** the `{ grammar }` partial SHALL carry `llm: { provider: "<provider>", model: "<id>" }`
  (the single selection split into the unchanged core two-field shape)

### Requirement: Save persists a grammar partial via the auth-gated PUT /api/config

On **Save**, the component SHALL send a `{ grammar: <edited block> }` partial to the
auth-gated `PUT /api/config` and re-sync its state from the reloaded config in the response.
It SHALL NOT bypass the network/auth guard and SHALL NOT write to `plugins.<id>.*`. A
**Reload** action SHALL re-read `GET /api/config` and discard local edits. Server-side
`parseGrammarConfig` remains the clamp/validation authority.

#### Scenario: Save writes only the grammar block
- **WHEN** the user edits `debounceMs` to 2000 and clicks Save
- **THEN** the component SHALL `PUT /api/config` with body `{ grammar: { … debounceMs: 2000 } }`
- **AND** other top-level config keys SHALL be left untouched by the partial

#### Scenario: Server clamps out-of-range input
- **WHEN** the user submits `debounceMs: 50` (below the `300` floor)
- **THEN** the persisted value SHALL be clamped to `300` by the server
- **AND** the form SHALL re-sync to the clamped value from the reload response

#### Scenario: Nested objects are preserved on partial write
- **WHEN** the user changes only `languagetool.url` and clicks Save
- **THEN** the persisted `grammar.languagetool` SHALL retain a valid `url`
- **AND** an unrelated `grammar.llm` block (if present) SHALL NOT be dropped

### Requirement: LanguageTool reachability indicator reuses GET /api/grammar/health

When `backend` is `languagetool`, the component SHALL surface whether the configured
`languagetool.url` is reachable, using the existing `GET /api/grammar/health`
(`{ languagetool: { url, reachable } }`). It SHALL NOT introduce a new health endpoint.

#### Scenario: Reachable server shows a healthy indicator
- **WHEN** `GET /api/grammar/health` reports `languagetool.reachable === true`
- **THEN** the section SHALL show a reachable/healthy indicator for the configured URL

#### Scenario: Unreachable server shows an unhealthy indicator
- **WHEN** `GET /api/grammar/health` reports `languagetool.reachable === false`
- **THEN** the section SHALL show an unreachable/unhealthy indicator for the configured URL

### Requirement: All user-facing strings are localized (en + hu)

Every user-facing string in the section SHALL be provided via the plugin's i18n catalog with
an English catalog and a Hungarian (`hu`) catalog, resolved through the runtime translation
hook. No hard-coded display strings SHALL remain in the component.

#### Scenario: Hungarian locale renders translated labels
- **WHEN** the dashboard locale is `hu`
- **THEN** the section labels SHALL render from the `hu` catalog, not English fallbacks
