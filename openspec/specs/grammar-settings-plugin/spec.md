# grammar-settings-plugin Specification

## Purpose
TBD - created by archiving change add-grammar-settings-plugin. Update Purpose after archive.
## Requirements
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

### Requirement: All user-facing strings are localized (en + hu)

Every user-facing string in the section SHALL be provided via the plugin's i18n catalog with
an English catalog and a Hungarian (`hu`) catalog, resolved through the runtime translation
hook. No hard-coded display strings SHALL remain in the component.

#### Scenario: Hungarian locale renders translated labels
- **WHEN** the dashboard locale is `hu`
- **THEN** the section labels SHALL render from the `hu` catalog, not English fallbacks

### Requirement: LLM-only settings controls read/write the plugin config namespace `plugins.grammar`

The `GrammarSettings` component SHALL expose controls for the LLM-only grammar
config shape (`enabled`, `autoCheck`, `debounceMs`, `minChars`, `maxChars`,
`language`, a SINGLE model picker, `capitalizeFirstWord`, and `correctionView`
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
- **WHEN** `plugins.grammar.llm` is unset
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
  plugin config

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

### Requirement: Model-candidate guidance is documented and linked

The settings section SHALL surface a short inline hint next to the model picker
explaining that model choice affects grammar quality, latency, and cost, SHALL
link to a documentation page (under `docs/`) describing recommended models and
their tradeoffs, AND SHALL provide an inline, collapsed-by-default disclosure
listing a short curated set of recommended models.

#### Scenario: Hint and link render by the model picker
- **WHEN** the section renders the model picker
- **THEN** a localized inline hint SHALL be shown
- **AND** a link to the model-guidance documentation SHALL be present

#### Scenario: The linked guidance target resolves
- **WHEN** the doc link rendered next to the model picker is resolved against the repository
- **THEN** it SHALL point at an existing `docs/` page describing recommended grammar models and
  their latency/quality/cost tradeoffs (a repo-lint file-existence check on the link target)

#### Scenario: An inline recommended-models disclosure lists the top models
- **WHEN** the user expands the recommended-models disclosure by the model picker
- **THEN** it SHALL list a short curated set (from the OpenRouter grammar
  competition) including `openai/gpt-4.1-nano` marked as the recommended default
- **AND** it SHALL be collapsed by default and SHALL NOT duplicate the full
  benchmark table (which remains in the linked doc)
- **AND** the disclosure SHALL NOT be nested inside the model-picker `<label>`
  (a `<details>` inside a `<label>` is invalid and would toggle the label's
  control)

### Requirement: Settings section renders from theme tokens with no inline styles (LLM-only)

The `GrammarSettings` section SHALL derive every color from the dashboard theme
CSS custom properties (e.g. `--text-muted`, `--text-secondary`,
`--severity-warning-fg`, `--border-primary`), SHALL NOT contain any hardcoded
color literal (`#rgb` / `#rrggbb` / `rgba()` / `hsl()`), and SHALL NOT use inline
`style` attributes for layout or color on elements the plugin owns — presentation
SHALL be expressed as theme-token utility classes (the `blackhole`/`hermes`
idiom). Status colors SHALL be semantic (success / warning tokens, e.g. the
model-required prompt in `--severity-warning-fg`). The section SHALL NOT render a
LanguageTool reachability marker (the backend and its health probe are removed).
It adapts across all four `data-theme` values (studio · earth · athlete ·
gradient). Every interactive control SHALL expose a visible keyboard focus
indicator and derive foreground/background from theme tokens, so the section
meets WCAG-AA contrast in every theme.

#### Scenario: No hardcoded color literals survive
- **WHEN** the `GrammarSettings` section renders
- **THEN** no inline style or class in the section SHALL contain a `#rgb`/`#rrggbb`/`rgba()`/`hsl()`
  literal
- **AND** every color SHALL reference a `var(--…)` theme token

#### Scenario: No inline style attributes remain on plugin-owned elements
- **WHEN** the `GrammarSettings` section renders
- **THEN** no plugin-owned element in the section SHALL carry an inline `style`
  attribute for layout or color (presentation is class-based)
- **AND** the host-injected `ui:model-selector` primitive subtree
  (`[data-testid="grammar-llm-model-selector"]` descendants) is EXEMPT — the
  plugin does not control its inline styles

#### Scenario: No LanguageTool reachability marker is rendered
- **WHEN** the `GrammarSettings` section renders
- **THEN** it SHALL NOT render a LanguageTool reachability/health marker

#### Scenario: Controls adapt to the active theme
- **WHEN** the dashboard `data-theme` attribute changes (studio · earth · athlete · gradient)
- **THEN** the section's labels, borders, status text, and control foreground/background SHALL
  update to the active theme's token values with no stale hardcoded color

#### Scenario: Interactive controls have a visible focus indicator
- **WHEN** the user tabs through the section's checkboxes, selects, inputs, and accordion summaries
- **THEN** each focused control SHALL show a visible focus indicator (the shared `focus-ring`
  affordance or equivalent)

