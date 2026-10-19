## MODIFIED Requirements

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

## ADDED Requirements

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
