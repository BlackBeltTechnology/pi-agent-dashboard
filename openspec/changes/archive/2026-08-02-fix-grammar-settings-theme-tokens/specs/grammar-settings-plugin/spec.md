# grammar-settings-plugin Specification

## ADDED Requirements

### Requirement: Settings section renders from theme tokens with accessible controls

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
- **WHEN** the user tabs through the section's checkboxes, selects, inputs, and Save/Reload/Test
  buttons
- **THEN** each focused control SHALL show a visible focus indicator (the shared `focus-ring`
  affordance or equivalent)

#### Scenario: Status colors are semantic and theme-aware
- **WHEN** the LanguageTool health probe reports reachable vs unreachable, or the draft is dirty
- **THEN** the reachable marker SHALL use `--severity-success-fg`, and the unreachable and
  "unsaved" markers SHALL use `--severity-warning-fg`
- **AND** these SHALL meet WCAG-AA contrast against the section background in every theme
