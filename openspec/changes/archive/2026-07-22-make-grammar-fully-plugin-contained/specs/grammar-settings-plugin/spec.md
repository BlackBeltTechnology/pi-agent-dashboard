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

#### Scenario: Section renders under the plugin's row on the General tab
- **WHEN** the plugin is enabled and the Settings page General tab is open
- **THEN** the `GrammarSettings` component SHALL render under the plugin's own row
- **AND** it SHALL appear below the core settings sections (plugin contributions sort after
  core, then by priority)

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

## REMOVED Requirements

### Requirement: Settings controls are bound to the core `config.grammar` block
**Reason**: Grammar config moved out of core (`config.grammar`) into the plugin config namespace
`plugins.grammar.*`. Superseded by the ADDED requirement below.
**Migration**: The plugin's server entry does a one-time read-through of any legacy
`config.grammar` into `plugins.grammar` on first load (non-destructive).

### Requirement: Save persists a grammar partial via the auth-gated PUT /api/config
**Reason**: Save now targets the plugin config endpoint, not the core config PUT.
**Migration**: `GrammarSettings` writes via `POST /api/config/plugins/grammar` (auth-gated by the
same Fastify chain as `POST /api/config`).

## ADDED Requirements

### Requirement: Settings controls read/write the plugin config namespace `plugins.grammar`

The `GrammarSettings` component SHALL expose controls for the full grammar config shape
(`enabled`, `autoCheck`, `backend` (`languagetool` | `llm`), `debounceMs`, `minChars`, `maxChars`,
`language`, `languagetool.url`, and a SINGLE model picker when `backend === "llm"`). Values SHALL
be read from and written to the plugin config namespace `plugins.grammar.*` (validated by the
plugin `configSchema`), NOT the core `config.grammar` block.

#### Scenario: Current values load from the plugin config
- **WHEN** the section mounts
- **THEN** it SHALL issue `GET /api/config` and populate every control from `data.plugins.grammar`
- **AND** if absent it SHALL show the disabled defaults (`enabled: false`,
  `backend: "languagetool"`, `autoCheck: true`, `debounceMs: 1200`, `minChars: 12`,
  `maxChars: 4000`, `language: "auto"`, `languagetool.url: "http://localhost:8081"`)

#### Scenario: A single model selector is used for the llm backend
- **WHEN** `backend` is `languagetool`
- **THEN** no model selector SHALL be shown
- **WHEN** `backend` is `llm`
- **THEN** a single model picker SHALL be shown (the `ui:model-selector` primitive fed by
  `GET /api/models`), with NO separate free-text `provider`/`model` fields

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
