# grammar-settings-plugin Specification

## MODIFIED Requirements

### Requirement: Plugin manifest claims the settings-section slot

The grammar plugin (renamed `grammar`, formerly `grammar-settings`) SHALL be a first-party package
under `packages/*` whose `package.json` carries a `pi-dashboard-plugin` manifest with
`id: "grammar"`, `priority: 100`, a `client` entry, a **`server` entry**, and a **`configSchema`**.
It SHALL claim BOTH `{ slot: "settings-section", component: "GrammarSettings", tab: "general" }`
AND `{ slot: "composer-panel", component: "GrammarPanel" }`. The plugin SHALL be discovered
automatically (scanning `packages/*/package.json`) with no edit to any core registry, and SHALL be
listed in `BUNDLED_PLUGINS`. Core SHALL contain no grammar-specific code — the check route,
composer surface, and config all live in the plugin.

#### Scenario: Manifest is discovered and generates a registry entry
- **WHEN** the plugin package exists under `packages/grammar-plugin/` with its manifest
- **THEN** the vite plugin SHALL include it in the generated
  `packages/client/src/generated/plugin-registry.tsx`
- **AND** the claims SHALL target `settings-section` (`GrammarSettings`) and `composer-panel`
  (`GrammarPanel`)

#### Scenario: Server entry registers the grammar route
- **WHEN** the dashboard server finishes bootstrap AND the grammar plugin is enabled
- **THEN** the plugin `server` entry SHALL register `/api/grammar/check` + `/api/grammar/health`
  via `ctx.fastify`
- **AND** its `llm` backend SHALL run through `ctx.modelRuntime` (in-process), preserving the
  Google→OpenAI-compat reroute

#### Scenario: Disabled plugin contributes nothing
- **WHEN** the grammar plugin is disabled in config
- **THEN** no `GrammarSettings` section AND no `GrammarPanel` SHALL render
- **AND** the `/api/grammar/*` routes SHALL NOT be registered

### Requirement: Settings controls are bound to the core `config.grammar` block

The `GrammarSettings` component SHALL expose controls for the full grammar config shape
(`enabled`, `autoCheck`, `backend` (`languagetool` | `llm`), `debounceMs`, `minChars`, `maxChars`,
`language`, `languagetool.url`, and a SINGLE model picker when `backend === "llm"`). Values SHALL
be read from and written to the plugin config namespace `plugins.grammar.*` (validated by the
plugin `configSchema`), NOT the core `config.grammar` block. On first load, if `plugins.grammar`
is empty AND a legacy `config.grammar` exists, the plugin SHALL read it through once (non-
destructive migration).

#### Scenario: Current values load from the plugin config
- **WHEN** the section mounts
- **THEN** it SHALL populate every control from `plugins.grammar.*`
- **AND** if empty it SHALL fall back to the legacy `config.grammar` (read-through) or the disabled
  defaults (`enabled: false`, `backend: "languagetool"`, …)

#### Scenario: Save persists via the plugin config endpoint
- **WHEN** the user edits controls and clicks Save
- **THEN** the partial SHALL be written via `POST /api/config/plugins/grammar` (auth-gated),
  NOT `PUT /api/config#grammar`
- **AND** an `llm` model pick SHALL persist as `llm: { provider, model }` within the plugin config
