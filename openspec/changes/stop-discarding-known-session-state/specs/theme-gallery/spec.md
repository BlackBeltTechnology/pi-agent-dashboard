# theme-gallery Specification

## MODIFIED Requirements

### Requirement: Theme definitions
The client SHALL define 9 named color themes, each with dark and light CSS variable maps: Base, Dracula, Nord, GitHub, Catppuccin, Tokyo Night, Rosé Pine, Solarized, and Gruvbox. Each theme definition SHALL include values for all CSS custom properties used by the application (`--bg-*`, `--text-*`, `--border-*`, `--accent-*`, `--shadow-*`, `--link`, `--link-hover`). The Base theme values SHALL match the existing `:root` and `[data-theme="light"]` CSS values exactly. Themes adapted from palettes that publish only a dark variant (e.g. Dracula) SHALL hand-tune accent colors for the light variant so contrast against light backgrounds remains readable; themes whose source publishes both variants (e.g. Tokyo Night Night/Day, Rosé Pine Main/Dawn, Solarized, Gruvbox) SHALL use the official light variant.

Body-text tokens SHALL additionally meet a measured contrast floor. `--text-tertiary` and `--text-secondary` SHALL each reach **WCAG 2.1 AA 4.5:1** against **both** `--bg-tertiary` (cards, inputs) and `--bg-surface` (badges, buttons) in **every** palette. These two tokens carry 10–11 px body text in the session card, so the AA-large 3:1 allowance does NOT apply.

Fidelity to an upstream palette SHALL NOT override the contrast floor. Where a published value (e.g. Dracula's comment colour `#6272a4`) fails, the theme SHALL adjust lightness while preserving hue and saturation, so the theme keeps its identity.

The text hierarchy SHALL be preserved after remediation: `--text-tertiary` SHALL NOT measure a higher contrast than `--text-secondary` against the same background. Raising tertiary to the floor while leaving secondary below it inverts the hierarchy — the token meant to recede becomes the most legible — which is a regression even though both numbers improved.

#### Scenario: All themes define all variables
- **WHEN** a theme is loaded
- **THEN** it SHALL provide values for every CSS custom property used in the application

#### Scenario: Base theme matches existing CSS
- **WHEN** the Base theme is active
- **THEN** the rendered colors SHALL be identical to the current application appearance
- **AND** any remediated token value SHALL be applied to BOTH `themes.ts` and the `index.css` `:root` / `[data-theme="light"]` blocks, so the two sources cannot drift

#### Scenario: Theme dark/light variants
- **WHEN** any theme is selected
- **THEN** it SHALL have both a dark and light variant that the System/Light/Dark toggle can switch between

#### Scenario: Every palette meets the body-text contrast floor

- **GIVEN** all 18 palettes (9 themes × dark/light)
- **WHEN** contrast is computed for `--text-tertiary` and `--text-secondary` against `--bg-tertiary` and `--bg-surface`
- **THEN** every one of those ratios SHALL be ≥ 4.5:1
- **AND** a test SHALL fail if any palette regresses below the floor

#### Scenario: Hierarchy survives remediation

- **GIVEN** a palette whose `--text-tertiary` was raised to meet the floor
- **WHEN** both tokens are measured against `--bg-tertiary`
- **THEN** `--text-secondary` SHALL measure at least as high as `--text-tertiary`
- **AND** a palette where lifting tertiary alone would invert the order SHALL have its `--text-secondary` lifted in the same change

#### Scenario: Remediation preserves theme identity

- **GIVEN** an upstream palette value that fails the floor
- **WHEN** it is remediated
- **THEN** the replacement SHALL preserve the original hue and saturation, adjusting lightness only
- **AND** SHALL NOT be replaced with a neutral grey
