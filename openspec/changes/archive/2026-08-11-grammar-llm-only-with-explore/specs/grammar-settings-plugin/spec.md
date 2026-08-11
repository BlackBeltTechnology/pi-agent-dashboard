## REMOVED Requirements

### Requirement: LanguageTool reachability indicator reuses GET /api/grammar/health

**Reason**: The LanguageTool backend is removed, so there is no configured
`languagetool.url` to probe and `GET /api/grammar/health` no longer returns a
`languagetool` block. A reachability indicator for a non-existent backend is
unreachable UI.

**Migration**: None. The health endpoint's LLM-only shape is specified by
`grammar-check-service` → "Grammar health probe". The settings section renders no
backend picker and no LT-URL field (see the ADDED "Settings controls read/write
the plugin config namespace `plugins.grammar`" below).

### Requirement: Settings controls read/write the plugin config namespace `plugins.grammar`

**Reason**: The prior requirement mandated a `backend` (`languagetool` | `llm`)
control, a `languagetool.url` field, and a "single model selector … WHEN
`backend` is `languagetool` … no model selector" scenario — all unreachable once
the LanguageTool backend is removed. Replaced wholesale by the ADDED "LLM-only
settings controls read/write the plugin config namespace `plugins.grammar`"
(renamed so the delta is an explicit remove+add, not a silent scenario drop).

**Migration**: See the ADDED "LLM-only settings controls read/write the plugin
config namespace `plugins.grammar`" below.

### Requirement: Settings section renders from theme tokens with accessible controls

**Reason**: The prior requirement's "Status colors are semantic and theme-aware"
scenario keyed the success/warning markers off a LanguageTool reachability
probe, gone with the backend. Replaced wholesale by the ADDED "Settings section
renders from theme tokens with accessible controls (LLM-only)" with the status
marker scoped to the unsaved/dirty state only.

**Migration**: See the ADDED "Settings section renders from theme tokens with
accessible controls (LLM-only)" below.

## ADDED Requirements

### Requirement: LLM-only settings controls read/write the plugin config namespace `plugins.grammar`

The `GrammarSettings` component SHALL expose controls for the LLM-only grammar
config shape (`enabled`, `autoCheck`, `debounceMs`, `minChars`, `maxChars`,
`language`, a SINGLE model picker, `capitalizeFirstWord`, and `correctionView`
(`redline` | `list`, default `redline`) as a segmented **Correction view**
control). It SHALL NOT render a backend selector or a LanguageTool URL field.
Values SHALL be read from and written to the plugin config namespace
`plugins.grammar.*` (validated by the plugin `configSchema`), NOT the core
`config.grammar` block.

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
- **WHEN** the user sets **Correction view** to `list` (or `redline`) and clicks
  Save
- **THEN** the value SHALL be written as `plugins.grammar.correctionView` via
  `POST /api/config/plugins/grammar`
- **AND** a subsequent `GET /api/grammar/health` SHALL report the saved
  `correctionView`

#### Scenario: Save persists via the plugin config endpoint
- **WHEN** the user edits controls and clicks Save
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

### Requirement: Settings section renders from theme tokens with accessible controls (LLM-only)

The `GrammarSettings` section SHALL derive every color from the dashboard theme CSS custom
properties (e.g. `--text-muted`, `--text-secondary`, `--severity-success-fg`,
`--severity-warning-fg`, `--border-primary`) and SHALL NOT contain any hardcoded color literal
(`#rgb` / `#rrggbb` / `rgba()` / `hsl()`), so it adapts across all four `data-theme` values
(studio · earth · athlete · gradient). Its interactive controls SHALL expose a visible keyboard
focus indicator and derive foreground/background from theme tokens (not user-agent defaults),
and status colors SHALL be semantic (success / warning tokens), so the section meets WCAG-AA
contrast in every theme.

#### Scenario: No hardcoded color literals survive
- **WHEN** the `GrammarSettings` section renders
- **THEN** no inline style or class in the section SHALL contain a `#rgb`/`#rrggbb`/`rgba()`/`hsl()`
  literal
- **AND** every color SHALL reference a `var(--…)` theme token

#### Scenario: Controls adapt to the active theme
- **WHEN** the dashboard `data-theme` attribute changes (studio · earth · athlete · gradient)
- **THEN** the section's labels, borders, status text, and control foreground/background SHALL
  update to the active theme's token values with no stale hardcoded color

#### Scenario: Interactive controls have a visible focus indicator
- **WHEN** the user tabs through the section's checkboxes, selects, inputs, and Save/Reload
  buttons
- **THEN** each focused control SHALL show a visible focus indicator (the shared `focus-ring`
  affordance or equivalent)

#### Scenario: The unsaved status marker is semantic and theme-aware
- **WHEN** the draft has unsaved changes
- **THEN** the "unsaved" marker SHALL use `--severity-warning-fg`
- **AND** it SHALL meet WCAG-AA contrast against the section background in every theme
- **AND** there SHALL be no LanguageTool reachability marker (the backend and its health probe
  are removed)

### Requirement: Model-candidate guidance is documented and linked

The settings section SHALL surface a short inline hint next to the model picker
explaining that model choice affects grammar quality, latency, and cost, and
SHALL link to a documentation page describing recommended models and their
tradeoffs. The linked guidance SHALL live under `docs/`.

#### Scenario: Hint and link render by the model picker
- **WHEN** the section renders the model picker
- **THEN** a localized inline hint SHALL be shown
- **AND** a link to the model-guidance documentation SHALL be present

#### Scenario: The linked guidance target resolves
- **WHEN** the doc link rendered next to the model picker is resolved against the repository
- **THEN** it SHALL point at an existing `docs/` page describing recommended grammar models and
  their latency/quality/cost tradeoffs (a repo-lint file-existence check on the link target)
