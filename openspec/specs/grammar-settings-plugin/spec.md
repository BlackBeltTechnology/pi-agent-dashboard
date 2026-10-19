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
CSS custom properties (e.g. `--text-secondary`, `--severity-warning-fg`,
`--border-primary`), SHALL NOT contain any hardcoded color literal (`#rgb` /
`#rrggbb` / `rgba()` / `hsl()`), and SHALL NOT use inline `style` attributes for
layout or color on elements the plugin owns — presentation SHALL be expressed as
theme-token utility classes or the shared settings field kit. Readable text (hints,
notes, table cells) SHALL NOT be painted in `--text-muted` or `--text-faint`, and
no text in the section SHALL render below 11 px; interactive text SHALL be at least
12 px. Status colors SHALL be semantic (success / warning / error tokens, e.g. the
model-required prompt in `--severity-warning-fg`). The section SHALL NOT render a
LanguageTool reachability marker (the backend and its health probe are removed).
It adapts across the theme matrix (base dark, base light, and the runtime
palettes such as nord dark). Every interactive control SHALL expose a visible keyboard focus
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

#### Scenario: No text below the type floor
- **WHEN** the `GrammarSettings` section renders in any state
- **THEN** no text element in the section SHALL have a computed font size below 11 px
- **AND** no hint, note or table cell SHALL be colored `--text-muted` or `--text-faint`

#### Scenario: No LanguageTool reachability marker is rendered
- **WHEN** the `GrammarSettings` section renders
- **THEN** it SHALL NOT render a LanguageTool reachability/health marker

#### Scenario: Controls adapt to the active theme
- **WHEN** the dashboard theme changes between base dark, base light and nord dark
- **THEN** the section's labels, borders, status text, and control foreground/background SHALL
  update to the active theme's token values with no stale hardcoded color

#### Scenario: Interactive controls have a visible focus indicator
- **WHEN** the user tabs through the section's switches, selects, inputs, and group summaries
- **THEN** each focused control SHALL show a visible focus indicator (the shared `focus-ring`
  affordance or equivalent)

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

### Requirement: Grammar model prompt is readable
The model-required prompt (`data-testid="grammar-model-required"`) SHALL render as a warning-severity callout with an icon at 12 px, not 10 px text, and the grammar model trigger SHALL show a role ref through the shared role-ref display.

#### Scenario: Missing model prompt meets the type floor
- **WHEN** the grammar settings render with no model set
- **THEN** `grammar-model-required` is a warning callout whose text is at least 12 px with colours equal to the active theme's `--severity-warning-*` values

### Requirement: Grammar settings body uses shared settings groups and no identity header

The `GrammarSettings` body SHALL NOT render a heading or chip repeating the plugin
title ("Grammar & Spelling") or id (`grammar`); the host chrome owns identity. The
body SHALL organize its controls into three shared settings groups titled
"Checking", "Model" and "Advanced", with "Advanced" collapsed by default. The
in-body `enabled` switch SHALL be labelled "Check grammar in the composer" (never
"Enabled", "Enable" or "On"); its config key `plugins.grammar.enabled` and its
testid `grammar-enabled` SHALL stay unchanged. Every field SHALL have a visible
label programmatically tied to its control and a hint tied to the control via
`aria-describedby` (the shared field `hint` is required; `null` only per the
`settings-panel` term-of-art rule); the "Model" label SHALL be tied to the
model picker. Units and ranges SHALL appear in a unit chip and the hint, not in
the label. Configuration SHALL continue to save only through the host Save bar
(draft id `plugin:grammar`); the body SHALL render no Save button of its own.

#### Scenario: Body does not repeat the plugin identity
- **WHEN** `/settings/plugins/grammar` renders
- **THEN** the plugin body SHALL contain no element whose text equals "Grammar & Spelling" or `grammar` as a heading or id chip

#### Scenario: Groups render with Advanced collapsed
- **WHEN** the section renders with a loaded config
- **THEN** groups "Checking", "Model" and "Advanced" SHALL be shown in that order
- **AND** "Advanced" SHALL be collapsed until the user expands it
- **AND** each group's summary SHALL be reachable and toggleable by keyboard

#### Scenario: In-body switch names what it controls
- **WHEN** the "Checking" group renders
- **THEN** the switch with testid `grammar-enabled` SHALL be labelled "Check grammar in the composer" and expose `role="switch"`
- **AND** toggling it and saving from the host Save bar SHALL write `plugins.grammar.enabled`

#### Scenario: Every field has a tied label and hint
- **WHEN** a screen reader focuses the "Wait after typing" number field
- **THEN** its accessible name SHALL include the label and the unit "ms", and its accessible description SHALL be the hint giving its range

### Requirement: Grammar settings validate the character range

The "Shortest text" field (`minChars`, testid `grammar-minchars`) SHALL be less
than the "Longest text" field (`maxChars`, testid `grammar-maxchars`). When it is
not, the section SHALL show a field error under "Shortest text" naming the bound
(naming the current Longest text value, for example "Must be less than the longest text (<maxChars>)."), SHALL mark the
control `aria-invalid`, SHALL open the "Advanced" group if collapsed, and the host
Save bar commit SHALL be blocked until the values are valid.

#### Scenario: Shortest text not below longest text blocks save
- **WHEN** the user sets Shortest text to 5000 while Longest text is 4000
- **THEN** a field error SHALL appear under Shortest text and the control SHALL be `aria-invalid="true"`
- **AND** committing from the host Save bar SHALL NOT write `plugins.grammar` and the source SHALL stay dirty

#### Scenario: Correcting the value clears the error
- **WHEN** the user then sets Shortest text to 12
- **THEN** the field error SHALL disappear and saving SHALL be allowed

### Requirement: Grammar settings report load and save failures in plain words

When loading the grammar config fails, the section SHALL show an error notice
reading "Could not load the grammar settings. Showing defaults; saving is off until
they load." with a "Try again" action that re-requests the config, and SHALL keep
saving disabled (the draft never commits) until a load succeeds. When a save fails,
the failure reported to the user SHALL be a sentence naming the problem and the
fix, NOT the raw string `grammar config save failed (NNN)`; any raw status or code
SHALL only be available behind a "Copy details" action. A failed save SHALL keep
the section dirty.

#### Scenario: Load failure shows a notice with Try again
- **WHEN** `GET /api/config` fails while the section mounts
- **THEN** an error notice starting "Could not load the grammar settings" SHALL render with a "Try again" button
- **AND** the host Save bar SHALL NOT commit `plugin:grammar` until a reload succeeds

#### Scenario: Try again recovers
- **WHEN** the user presses "Try again" and the config request succeeds
- **THEN** the notice SHALL disappear and the controls SHALL show the loaded values

#### Scenario: Save failure is a sentence
- **WHEN** `POST /api/config/plugins/grammar` responds 500
- **THEN** the user-visible error SHALL be a plain sentence and SHALL NOT contain `grammar config save failed (500)`

### Requirement: Recommended models render as a readable table

The recommended-models disclosure (testid `grammar-recommended-models`) SHALL
render its curated models as a read-only table (columns: model, status, notes) with
text at 11 px or larger (cells at 12 px), and SHALL mark the recommended default
with a "Recommended" status pill carrying the word, not color alone. Notes such as
models to avoid SHALL render at 12 px in `--text-secondary`. The disclosure SHALL
stay collapsed by default.

#### Scenario: Recommended default carries a word pill
- **WHEN** the user expands "Recommended models"
- **THEN** a table SHALL list the curated models
- **AND** the recommended default's row SHALL show a success-tone pill with the word "Recommended"
- **AND** no text in the table SHALL be below 11 px
